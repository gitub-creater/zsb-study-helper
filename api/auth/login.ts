import {
  db, getBody, handleOptions, passwordMatchesAsync, publicUser, sendError, setCors,
} from '../../server/cloud-api.js'

interface LoginRequest {
  name?: string
  password?: string
  email?: string
  code?: string
}

interface StrictAuthReply {
  code?: string
  error?: string
  user?: { id: string; name: string; email?: string }
  token?: string
}

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i

function statusFor(code: string | undefined): number {
  if (code === 'not_found') return 404
  if (code === 'bad_password' || code === 'email_mismatch' || code === 'invalid_code') return 401
  if (code === 'name_taken' || code === 'email_taken') return 409
  return 400
}

async function strictLogin(name: string, password: string, email: string, code: string): Promise<StrictAuthReply> {
  const { data, error } = await db().rpc('zsb_login_verified', {
    p_name: name,
    p_password: password,
    p_email: email,
    p_code: code,
  })
  if (error) throw error
  return (data ?? {}) as StrictAuthReply
}

export default async function handler(req: import('../../server/cloud-api.js').ApiRequest, res: import('../../server/cloud-api.js').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const { name, password, email, code } = getBody<LoginRequest>(req)
    const normalizedEmail = email?.trim().toLowerCase() ?? ''
    if (!name?.trim() || !password || !EMAIL_REGEX.test(normalizedEmail) || !/^\d{6}$/.test(code?.trim() ?? '')) {
      return sendError(res, 400, 'invalid_input', '账号、密码、邮箱和验证码格式不正确')
    }

    let result = await strictLogin(name.trim(), password, normalizedEmail, code!.trim())

    // 历史账号的密码摘要由 Vercel 使用 scrypt 保存。验证密码后将它升级为
    // pgcrypto bcrypt，再重新进入同一条原子严格登录 RPC。
    if (result.code === 'legacy_account') {
      const { data: legacy, error: legacyError } = await db()
        .from('app_users')
        .select('id, name, email, password_salt, password_hash')
        .eq('name_normalized', name.trim().toLocaleLowerCase('zh-CN'))
        .maybeSingle()
      if (legacyError) throw legacyError
      if (!legacy) return sendError(res, 404, 'not_found', '账号不存在')
      if (legacy.email && legacy.email.toLowerCase() !== normalizedEmail) {
        return sendError(res, 401, 'email_mismatch', '邮箱与账号绑定信息不一致')
      }
      if (!(await passwordMatchesAsync(password, legacy.password_salt, legacy.password_hash))) {
        return sendError(res, 401, 'bad_password', '密码不正确')
      }
      const { error: upgradeError } = await db().rpc('zsb_set_bf_password', {
        p_id: legacy.id,
        p_password: password,
      })
      if (upgradeError) throw upgradeError
      result = await strictLogin(name.trim(), password, normalizedEmail, code!.trim())
    }

    if (!result.user || !result.token) {
      return sendError(res, statusFor(result.code), result.code || 'invalid_input', result.error || '登录失败')
    }
    return res.status(200).json({ user: publicUser(result.user), token: result.token })
  } catch (error) {
    console.error('Strict cloud login failed', error)
    return sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

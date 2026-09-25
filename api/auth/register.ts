import { db, getBody, handleOptions, sendError, setCors, validName, validPassword } from '../../server/cloud-api.js'

interface RegisterRequest {
  id?: string
  name?: string
  password?: string
  email?: string
  code?: string
}

interface StrictRegisterReply {
  code?: string
  error?: string
  user?: { id: string; name: string; email?: string }
  token?: string
}

function statusFor(code: string | undefined): number {
  if (code === 'invalid_code') return 401
  if (code === 'name_taken' || code === 'email_taken') return 409
  return 400
}

export default async function handler(req: import('../../server/cloud-api.js').ApiRequest, res: import('../../server/cloud-api.js').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const { id, name, password, email, code } = getBody<RegisterRequest>(req)
    const normalizedEmail = email?.trim().toLowerCase() ?? ''
    if (!id || !/^u_[a-z0-9]+$/i.test(id) || !name || !validName(name) || !password || !validPassword(password) || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || !/^\d{6}$/.test(code?.trim() ?? '')) {
      return sendError(res, 400, 'invalid_input', '账号、密码、邮箱或验证码格式不正确')
    }

    const { data, error } = await db().rpc('zsb_register_verified', {
      p_id: id,
      p_name: name.trim(),
      p_password: password,
      p_email: normalizedEmail,
      p_code: code!.trim(),
    })
    if (error) throw error
    const result = (data ?? {}) as StrictRegisterReply
    if (!result.user || !result.token) return sendError(res, statusFor(result.code), result.code || 'invalid_input', result.error || '注册失败')
    return res.status(201).json({ user: result.user, token: result.token })
  } catch (error) {
    console.error('Strict cloud registration failed', error)
    return sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

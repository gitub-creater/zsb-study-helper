import { db, getBody, handleOptions, sendError, setCors, validPassword } from '../../server/cloud-api.js'

interface ResetRequest {
  email?: string
  code?: string
  newPassword?: string
  confirmPassword?: string
}

interface ResetReply {
  ok?: boolean
  code?: string
  error?: string
}

export default async function handler(req: import('../../server/cloud-api.js').ApiRequest, res: import('../../server/cloud-api.js').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const { email, code, newPassword, confirmPassword } = getBody<ResetRequest>(req)
    const normalizedEmail = email?.trim().toLowerCase() ?? ''
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || !/^\d{6}$/.test(code?.trim() ?? '') || !newPassword || !validPassword(newPassword) || newPassword !== confirmPassword) {
      return sendError(res, 400, 'invalid_input', '邮箱、验证码或新密码格式不正确')
    }

    const { data, error } = await db().rpc('zsb_reset_password_verified', {
      p_email: normalizedEmail,
      p_code: code!.trim(),
      p_new: newPassword,
    })
    if (error) throw error
    const result = (data ?? {}) as ResetReply
    if (result.ok !== true) {
      const status = result.code === 'not_found' ? 404 : result.code === 'invalid_code' ? 401 : 400
      return sendError(res, status, result.code || 'invalid_input', result.error || '重置密码失败')
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Cloud password reset failed', error)
    return sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

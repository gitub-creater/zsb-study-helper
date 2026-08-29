import {
  db, getBody, handleOptions, hashPassword, passwordMatches, sendError, sessionUser, setCors, validPassword,
} from '../../server/cloud-api'

export default async function handler(req: import('../../server/cloud-api').ApiRequest, res: import('../../server/cloud-api').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'PUT') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const user = await sessionUser(req)
    if (!user) return sendError(res, 401, 'unauthorized', '登录已过期，请重新登录')
    const { oldPassword, newPassword } = getBody<{ oldPassword?: string; newPassword?: string }>(req)
    if (!oldPassword || !newPassword || !validPassword(newPassword)) {
      return sendError(res, 400, 'invalid_input', '密码格式不正确')
    }
    if (!passwordMatches(oldPassword, user.password_salt, user.password_hash)) {
      return sendError(res, 401, 'bad_password', '旧密码不正确')
    }

    const { salt, hash } = hashPassword(newPassword)
    const { error } = await db()
      .from('app_users')
      .update({ password_salt: salt, password_hash: hash, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (error) throw error
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Cloud password update failed', error)
    sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

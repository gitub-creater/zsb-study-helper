import {
  createSession, db, getBody, handleOptions, normalizedName, passwordMatches, publicUser, sendError, setCors,
} from '../../server/cloud-api.js'

export default async function handler(req: import('../../server/cloud-api.js').ApiRequest, res: import('../../server/cloud-api.js').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const { name, password } = getBody<{ name?: string; password?: string }>(req)
    if (!name || !password) return sendError(res, 400, 'invalid_input', '请输入账号和密码')

    const { data: user, error } = await db()
      .from('app_users')
      .select('id, name, name_normalized, password_salt, password_hash')
      .eq('name_normalized', normalizedName(name))
      .maybeSingle()
    if (error) throw error
    if (!user) return sendError(res, 404, 'not_found', '账号不存在')
    if (!passwordMatches(password, user.password_salt, user.password_hash)) {
      return sendError(res, 401, 'bad_password', '密码不正确')
    }

    const token = await createSession(user.id)
    res.status(200).json({ user: publicUser(user), token })
  } catch (error) {
    console.error('Cloud login failed', error)
    sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

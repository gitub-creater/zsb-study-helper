import {
  createSession, db, getBody, handleOptions, hashPassword, normalizedName, publicUser, sendError, setCors,
  validName, validPassword,
} from '../../server/cloud-api'

export default async function handler(req: import('../../server/cloud-api').ApiRequest, res: import('../../server/cloud-api').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const { id, name, password } = getBody<{ id?: string; name?: string; password?: string }>(req)
    if (!id || !/^u_[a-z0-9]+$/i.test(id) || !name || !validName(name) || !password || !validPassword(password)) {
      return sendError(res, 400, 'invalid_input', '账号或密码格式不正确')
    }

    const normalized = normalizedName(name)
    const { data: existing, error: lookupError } = await db()
      .from('app_users')
      .select('id')
      .eq('name_normalized', normalized)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing) return sendError(res, 409, 'name_taken', '该账号已存在')

    const { salt, hash } = hashPassword(password)
    const { data: user, error } = await db()
      .from('app_users')
      .insert({ id, name: name.trim(), name_normalized: normalized, password_salt: salt, password_hash: hash })
      .select('id, name, name_normalized, password_salt, password_hash')
      .single()
    if (error) throw error

    const token = await createSession(user.id)
    res.status(201).json({ user: publicUser(user), token })
  } catch (error) {
    console.error('Cloud registration failed', error)
    sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

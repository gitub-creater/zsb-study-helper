import {
  db, handleOptions, normalizedName, publicUser, sendError, sessionUser, setCors,
} from '../../server/cloud-api.js'

export default async function handler(req: import('../../server/cloud-api.js').ApiRequest, res: import('../../server/cloud-api.js').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')
  try {
    const me = await sessionUser(req)
    if (!me) return sendError(res, 401, 'unauthorized', '请先登录云端账号')
    const raw = req.query?.q
    const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''
    if (!query) return sendError(res, 400, 'invalid_input', '请输入要查找的账号')
    const client = db()
    const byName = await client.from('app_users').select('id, name').eq('name_normalized', normalizedName(query)).limit(10)
    if (byName.error) throw byName.error
    let rows = byName.data ?? []
    if (rows.length === 0) {
      const byId = await client.from('app_users').select('id, name').eq('id', query).limit(1)
      if (byId.error) throw byId.error
      rows = byId.data ?? []
    }
    res.status(200).json({ users: rows.filter((u) => u.id !== me.id).map(publicUser) })
  } catch (error) {
    console.error('Cloud user lookup failed', error)
    sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

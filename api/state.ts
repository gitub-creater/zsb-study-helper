import { db, getBody, handleOptions, sendError, sessionUser, setCors } from '../server/cloud-api.js'

export default async function handler(req: import('../server/cloud-api.js').ApiRequest, res: import('../server/cloud-api.js').ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'GET' && req.method !== 'PUT') return sendError(res, 405, 'method_not_allowed', 'Method not allowed')

  try {
    const user = await sessionUser(req)
    if (!user) return sendError(res, 401, 'unauthorized', '登录已过期，请重新登录')

    if (req.method === 'GET') {
      const { data, error } = await db().from('user_states').select('state').eq('user_id', user.id).maybeSingle()
      if (error) throw error
      return res.status(200).json({ state: data?.state ?? null })
    }

    const { state } = getBody<{ state?: unknown }>(req)
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return sendError(res, 400, 'invalid_state', '学习数据格式不正确')
    }
    const { error } = await db().from('user_states').upsert({
      user_id: user.id,
      state,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Cloud state request failed', error)
    sendError(res, 503, 'service_unavailable', '云端服务暂时不可用')
  }
}

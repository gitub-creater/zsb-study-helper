/// <reference types="node" />
// 读取 OpenAI-compatible 上游的完整模型目录。密钥只随本次请求转发，不落库、不记录。
import { getBody, handleOptions, sendError, setCors } from '../../server/cloud-api.js'
import { proxyHeaders, validateAiModelsTarget } from './proxy.js'
import type { ApiRequest, ApiResponse } from '../../server/cloud-api.js'

export { validateAiModelsTarget }

type ModelsBody = {
  target?: unknown
  headers?: unknown
}

const UPSTREAM_TIMEOUT_MS = 20_000

function setUpstreamHeaders(res: ApiResponse, upstream: Response): void {
  const contentType = upstream.headers.get('content-type')
  const requestId = upstream.headers.get('x-request-id') || upstream.headers.get('request-id')
  if (contentType) res.setHeader('Content-Type', contentType)
  if (requestId) res.setHeader('X-Upstream-Request-Id', requestId)
  res.setHeader('X-ZSB-AI-Transport', 'proxy-models')
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', '仅支持 POST 请求')

  try {
    const { target, headers } = getBody<ModelsBody>(req)
    const targetError = validateAiModelsTarget(target)
    if (targetError) return sendError(res, 400, 'invalid_target', targetError)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    let upstream: Response
    try {
      upstream = await fetch(target as string, {
        method: 'GET',
        headers: proxyHeaders(headers),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        clearTimeout(timeout)
        return sendError(res, 504, 'upstream_timeout', '上游模型接口响应超时，请检查接口地址或稍后重试')
      }
      clearTimeout(timeout)
      throw error
    }
    setUpstreamHeaders(res, upstream)
    const text = await upstream.text()
    clearTimeout(timeout)
    res.status(upstream.status)
    try {
      res.json(JSON.parse(text))
    } catch {
      res.json({ code: 'invalid_upstream_response', error: '上游模型目录不是有效 JSON' })
    }
  } catch {
    // 不返回上游 URL、请求头或密钥，避免把敏感信息写入响应或日志。
    return sendError(res, 502, 'upstream_unreachable', '应用中转暂时无法读取上游模型列表，请检查接口地址或稍后重试')
  }
}

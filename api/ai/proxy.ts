/// <reference types="node" />
// OpenAI-compatible 转发：用于网页端跨域受限的服务商。密钥只存在单次请求中，不落库、不记录。
import { getBody, handleOptions, sendError, setCors } from '../../server/cloud-api.js'
import type { ApiRequest, ApiResponse } from '../../server/cloud-api.js'

type ProxyBody = {
  target?: unknown
  headers?: unknown
  payload?: unknown
}

type StreamingResponse = ApiResponse & {
  write: (chunk: Uint8Array) => void
}

// 保持在 Vercel Serverless 默认请求体上限以内；更大的图片请压缩后上传。
const MAX_PROXY_BODY_BYTES = 4_000_000
const BLOCKED_REQUEST_HEADERS = new Set([
  'connection', 'content-length', 'cookie', 'host', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return true
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

/** 导出以便覆盖 SSRF 防护和标准 OpenAI 端点的测试。 */
export function validateAiProxyTarget(target: unknown): string | null {
  if (typeof target !== 'string' || !target.trim()) return '缺少上游接口地址'
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return '上游接口地址格式不正确'
  }
  if (url.protocol !== 'https:') return '应用中转只允许 HTTPS 上游地址'
  if (url.username || url.password || isPrivateHost(url.hostname)) return '上游接口地址不允许使用本机或内网地址'
  if (!url.pathname.endsWith('/chat/completions') && !url.pathname.endsWith('/responses')) {
    return '上游地址必须指向 /chat/completions 或 /responses'
  }
  return null
}

function proxyHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { 'Content-Type': 'application/json' }
  const result: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim()
    if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue
    if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase()) || typeof rawValue !== 'string' || /[\r\n]/.test(rawValue)) continue
    result[name] = rawValue.slice(0, 4096)
  }
  if (!Object.keys(result).some((name) => name.toLowerCase() === 'content-type')) result['Content-Type'] = 'application/json'
  return result
}

function setUpstreamHeaders(res: ApiResponse, upstream: Response): void {
  const contentType = upstream.headers.get('content-type')
  const cacheControl = upstream.headers.get('cache-control')
  const requestId = upstream.headers.get('x-request-id') || upstream.headers.get('request-id')
  if (contentType) res.setHeader('Content-Type', contentType)
  if (cacheControl) res.setHeader('Cache-Control', cacheControl)
  if (requestId) res.setHeader('X-Upstream-Request-Id', requestId)
  res.setHeader('X-ZSB-AI-Transport', 'proxy')
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', '仅支持 POST 请求')

  try {
    const { target, headers, payload } = getBody<ProxyBody>(req)
    const targetError = validateAiProxyTarget(target)
    if (targetError) return sendError(res, 400, 'invalid_target', targetError)

    const encodedPayload = JSON.stringify(payload ?? {})
    if (Buffer.byteLength(encodedPayload, 'utf8') > MAX_PROXY_BODY_BYTES) {
      return sendError(res, 413, 'request_too_large', '请求内容过大，请减少图片或缩短材料后重试')
    }

    const upstream = await fetch(target as string, {
      method: 'POST',
      headers: proxyHeaders(headers),
      body: encodedPayload,
    })
    setUpstreamHeaders(res, upstream)
    res.status(upstream.status)
    if (!upstream.body) return res.end()

    const stream = res as StreamingResponse
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      stream.write(value)
    }
    stream.end()
  } catch {
    // 不返回上游 URL、请求头或密钥，避免把敏感信息写入响应或日志。
    return sendError(res, 502, 'upstream_unreachable', '应用中转暂时无法连接上游服务，请检查接口地址或稍后重试')
  }
}

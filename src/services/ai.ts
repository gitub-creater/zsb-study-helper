// AI 服务层:豆包(火山方舟)/ DeepSeek / 通义千问 / 自定义 OpenAI 兼容网关
// 约束:密钥仅存本机由用户自行配置;三家均提供 OpenAI 兼容接口,统一走一个客户端;
//      浏览器直连可能遇到跨域,可改用 one-api/new-api 等兼容网关地址(选"自定义")

export type AiProviderId = 'doubao' | 'deepseek' | 'qwen' | 'custom'
export type AiTransport = 'auto' | 'direct' | 'proxy'

/**
 * GitHub Pages 是纯静态站点，第三方 OpenAI-compatible 服务常常不开放 CORS。
 * 因此默认提供同项目 Vercel 转发地址；密钥仅随单次请求转发，服务端不保存。
 */
export const DEFAULT_AI_PROXY_URL = 'https://shandong-zsb-study-helper.vercel.app/api/ai/proxy'
export const DEFAULT_AI_MODELS_PROXY_URL = 'https://shandong-zsb-study-helper.vercel.app/api/ai/models'

export interface AiConfig {
  provider: AiProviderId
  baseURL: string
  apiKey: string
  model: string
  transport?: AiTransport
  proxyURL?: string
  /** 思考程度:仅用于提示词分级与界面显示,不作为请求参数发送 */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** 请求协议。默认 chat/completions，Responses API 仅在服务商明确支持时选择。 */
  apiMode?: 'chat' | 'responses'
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number
  /** 是否请求 SSE 流式输出。 */
  stream?: boolean
  /** 发送给网关的额外请求头（不会写入源码）。 */
  customHeaders?: Record<string, string>
  temperature?: number
  maxTokens?: number
}

export interface AiModelOption {
  id: string
  name: string
  ownedBy?: string
}

export const AI_PRESETS: Record<AiProviderId, { name: string; baseURL: string; model: string; note: string }> = {
  doubao: {
    name: '豆包(火山方舟)',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-lite-32k-250115',
    note: '在火山方舟控制台开通模型;模型名填接入点 ID 或模型 ID',
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    note: '在 platform.deepseek.com 创建 API Key',
  },
  qwen: {
    name: '通义千问(阿里云百炼)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    note: '在阿里云百炼控制台创建 API Key',
  },
  custom: {
    name: '自定义(OpenAI 兼容网关)',
    baseURL: '',
    model: '',
    note: '推荐 one-api / new-api 等网关,可同时解决浏览器跨域问题',
  },
}

/** 图片题:OpenAI 兼容的多模态消息分片(文本 + 图片 dataURL) */
export interface ChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
}

/** 用户主动停止生成时抛出(区别于超时) */
export class AiAbortedError extends Error {
  constructor() {
    super('已停止生成')
    this.name = 'AiAbortedError'
  }
}

export class AiRequestError extends Error {
  readonly status: number
  readonly retryable: boolean
  constructor(status: number, message: string, retryable = false) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
    this.retryable = retryable
  }
}

function retryHint(status: number): string {
  if (status === 401 || status === 403) return '请检查 API Key、请求头和服务商权限。'
  if (status === 404) return '请检查 Base URL、接口协议和模型名称。'
  if (status === 402) return '请检查账户余额或套餐额度。'
  if (status === 408 || status === 429 || status >= 500) return '请稍后重试，或适当增大超时时间。'
  return '请检查服务商返回信息和网络连接。'
}

interface ParsedErrorDetail {
  detail: string
  code?: string
  param?: string
}

function parseErrorDetail(text: string): ParsedErrorDetail {
  let detail = text.trim()
  let code: string | undefined
  let param: string | undefined
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string; code?: string; param?: string } | string
      code?: string
      message?: string
      detail?: string
      param?: string
    }
    const errorDetail = typeof data.error === 'string' ? data.error : data.error?.message
    detail = errorDetail || data.message || data.detail || detail
    code = typeof data.error === 'object' ? data.error?.code : data.code
    param = typeof data.error === 'object' ? data.error?.param : data.param
  } catch {
    // 部分中转站返回纯文本，保留原文。
  }
  return { detail, code, param }
}

/** 服务商返回非 2xx 时抛出带 HTTP 状态、原始错误和重试建议的 Error。 */
export async function throwForStatus(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  const parsed = parseErrorDetail(text)
  let detail = parsed.detail
  if (parsed.code) detail = `${detail}（${parsed.code}）`
  const short = detail.slice(0, 240) || res.statusText || '未提供错误详情'
  throw new AiRequestError(res.status, `请求失败（HTTP ${res.status}）：${short} ${retryHint(res.status)}`, res.status === 408 || res.status === 429 || res.status >= 500)
}

function mapFetchError(e: unknown): unknown {
  if (e instanceof DOMException && e.name === 'AbortError') throw new Error('请求超时,请稍后重试或检查网络')
  if (e instanceof TypeError) {
    throw new Error('网络请求失败：请检查网络；若使用网页端，请在设置中选择“应用中转”或“自动”。')
  }
  return e
}

function assertConfigured(cfg: AiConfig): void {
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    throw new Error('AI 服务未配置完整(接口地址 / API Key / 模型名)')
  }
}

export function normalizeAiBaseURL(baseURL: string): string {
  const trimmed = baseURL.trim()
  if (!trimmed) return ''
  // OpenAI 官方文档同时常见根域名和 /v1 写法；根域名需要补上版本前缀。
  // 其他兼容网关不强行补 /v1，避免破坏其自定义路由。
  try {
    const url = new URL(trimmed)
    if (url.hostname === 'api.openai.com' && (!url.pathname || url.pathname === '/')) url.pathname = '/v1'
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

function endpointUrl(baseURL: string, endpoint: '/chat/completions' | '/responses' | '/models'): string {
  const base = normalizeAiBaseURL(baseURL)
  if (!base) return endpoint
  try {
    const url = new URL(base)
    const pathname = url.pathname.replace(/\/+$/, '')
    const known = ['/chat/completions', '/responses', '/models']
    const suffix = known.find((item) => pathname.endsWith(item))
    const root = suffix ? pathname.slice(0, -suffix.length) : pathname
    url.pathname = `${root.replace(/\/+$/, '')}${endpoint}` || endpoint
    return url.toString()
  } catch {
    const plain = base.replace(/\/+$/, '')
    const suffix = ['/chat/completions', '/responses', '/models'].find((item) => plain.endsWith(item))
    return `${suffix ? plain.slice(0, -suffix.length) : plain}${endpoint}`
  }
}

type AiEndpoint = '/chat/completions' | '/responses' | '/models'

/**
 * 同一兼容网关常见两种填写方式：根地址和带 /v1 的 Base URL。
 * 根地址先按原样请求；若上游明确返回 404/405，再尝试根地址 + /v1，避免误伤
 * 已经使用 /api/v3、/compatible-mode/v1 等自定义版本路径的服务商。
 */
function endpointCandidates(baseURL: string, endpoint: AiEndpoint): string[] {
  const primary = endpointUrl(baseURL, endpoint)
  const candidates = [primary]
  const base = normalizeAiBaseURL(baseURL)
  try {
    const url = new URL(base)
    const pathname = url.pathname.replace(/\/+$/, '')
    const hasVersionSegment = /(?:^|\/)v\d+(?:[-_.]\d+)*(?:\/|$)/i.test(pathname)
    const hasKnownEndpoint = ['/chat/completions', '/responses', '/models'].some((item) => pathname.endsWith(item))
    if (!hasKnownEndpoint && !hasVersionSegment) {
      const versioned = new URL(primary)
      versioned.pathname = `${pathname || ''}/v1${endpoint}`
      const value = versioned.toString()
      if (value !== primary) candidates.push(value)
    }
  } catch {
    // endpointUrl 已经提供了可用的原始拼接结果。
  }
  return candidates
}

/** 本机 Codex++/网关地址只能由桌面端或浏览器直连访问，不能交给公网中转。 */
function isLocalAiTarget(target: string): boolean {
  try {
    const url = new URL(target)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (url.protocol !== 'https:') return true
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') return true
    const parts = host.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
  } catch {
    return false
  }
}

async function requestEndpointCandidates(
  targets: string[],
  request: (target: string) => Promise<Response>,
): Promise<Response> {
  let lastResponse: Response | null = null
  let networkError: unknown = null
  for (let index = 0; index < targets.length; index += 1) {
    try {
      const response = await request(targets[index])
      lastResponse = response
      if ((response.status === 404 || response.status === 405) && index < targets.length - 1) {
        try { await response.body?.cancel() } catch { /* 继续尝试带 /v1 的候选地址 */ }
        continue
      }
      // 直连被浏览器 CORS 拦截时，某些代理会把第二个候选路径暴露成 404；
      // 保留 TypeError，让自动模式继续走应用中转。
      if (networkError && (response.status === 404 || response.status === 405)) throw networkError
      return response
    } catch (error) {
      if (error instanceof TypeError && index < targets.length - 1) {
        networkError = error
        continue
      }
      throw error
    }
  }
  if (lastResponse) return lastResponse
  throw networkError ?? new TypeError('Failed to fetch')
}

/** Base URL 可带 /v1 或完整标准端点；只在缺少具体路径时追加一次，并保留查询参数。 */
export function aiEndpoint(baseURL: string, mode: 'chat' | 'responses' = 'chat'): string {
  return endpointUrl(baseURL, mode === 'responses' ? '/responses' : '/chat/completions')
}

/** OpenAI-compatible 模型目录地址。Base URL 可以带 /v1 或完整接口路径。 */
export function aiModelsEndpoint(baseURL: string): string {
  return endpointUrl(baseURL, '/models')
}

function requestHeaders(cfg: AiConfig): Headers {
  const headers = new Headers({ ...(cfg.customHeaders ?? {}) })
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (cfg.apiKey && !headers.has('Authorization') && !headers.has('api-key') && !headers.has('x-api-key')) {
    headers.set('Authorization', `Bearer ${cfg.apiKey}`)
  }
  return headers
}

/** 推理模型通常不接受 temperature。不同厂商的 token 参数名并不统一。 */
function isReasoningModel(model: string): boolean {
  const value = model.trim().toLowerCase()
  return /(?:^|[-_/.])(?:o1|o3|o4|gpt-5)(?:[-_/.]|$)/.test(value)
}

/** 仅 OpenAI 新版推理模型固定使用 max_completion_tokens。
 * DeepSeek/Qwen 等兼容接口仍按官方文档使用 max_tokens，失败时再由兼容重试处理。 */
function usesCompletionTokenName(model: string): boolean {
  const value = model.trim().toLowerCase()
  return /(?:^|[-_/.])(?:o1|o3|o4|gpt-5)(?:[-_/.]|$)/.test(value)
}

type ResponsesInputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }

function responsesContent(content: ChatMessage['content']): ResponsesInputPart[] {
  if (typeof content === 'string') return [{ type: 'input_text', text: content }]
  const parts: ResponsesInputPart[] = []
  for (const part of content) {
    if (part.type === 'image_url' && part.image_url?.url) {
      parts.push({ type: 'input_image', image_url: part.image_url.url })
    } else if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text ?? '' })
    }
  }
  return parts.length ? parts : [{ type: 'input_text', text: '' }]
}

function responsesInput(messages: ChatMessage[]): Array<{ role: ChatMessage['role']; content: ResponsesInputPart[] }> {
  return messages.map((message) => ({ role: message.role, content: responsesContent(message.content) }))
}

function errorTextFromResponse(res: Response): Promise<string> {
  try {
    return res.clone().text().catch(() => '')
  } catch {
    return Promise.resolve('')
  }
}

/** 只对明确的“参数不支持”错误做一次兼容降级，避免重复发送正常失败请求。 */
function compatibilityPayload(
  mode: 'chat' | 'responses',
  payload: Record<string, unknown>,
  errorText: string,
): Record<string, unknown> | null {
  const parsed = parseErrorDetail(errorText)
  const haystack = `${parsed.param ?? ''} ${parsed.detail}`.toLowerCase()
  const unsupported = /(unsupported|not supported|unknown|unrecognized|invalid|not allowed|does not support|不支持|未知)/i.test(haystack)
  if (!unsupported) return null

  if ('temperature' in payload && /temperature|sampling temperature/.test(haystack)) {
    const next = { ...payload }
    delete next.temperature
    return next
  }

  if (mode === 'chat' && 'max_tokens' in payload && /max[_ ]tokens?|completion[_ ]tokens?/.test(haystack)) {
    const next: Record<string, unknown> = { ...payload, max_completion_tokens: payload.max_tokens }
    delete next.max_tokens
    return next
  }

  if (mode === 'chat' && 'max_completion_tokens' in payload && /max[_ ](?:completion_)?tokens?/.test(haystack)) {
    const next: Record<string, unknown> = { ...payload, max_tokens: payload.max_completion_tokens }
    delete next.max_completion_tokens
    return next
  }

  if (mode === 'responses' && 'max_output_tokens' in payload && /max[_ ](?:output_)?tokens?/.test(haystack)) {
    const suggestsMaxTokens = parsed.param?.toLowerCase() === 'max_tokens'
      || /max[_ ]output[_ ]tokens?[\s\S]{0,100}(?:use|instead|改用|使用)[\s\S]{0,100}max[_ ]tokens?/.test(haystack)
    if (suggestsMaxTokens) {
      const next: Record<string, unknown> = { ...payload, max_tokens: payload.max_output_tokens }
      delete next.max_output_tokens
      return next
    }
    const next = { ...payload }
    delete next.max_output_tokens
    return next
  }

  return null
}

function chatBody(cfg: AiConfig, messages: ChatMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream,
  }
  if (!isReasoningModel(cfg.model)) body.temperature = cfg.temperature ?? 0.2
  if (cfg.maxTokens != null && Number.isFinite(cfg.maxTokens)) {
    if (usesCompletionTokenName(cfg.model)) body.max_completion_tokens = cfg.maxTokens
    else body.max_tokens = cfg.maxTokens
  }
  return body
}

function responsesBody(cfg: AiConfig, messages: ChatMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    input: responsesInput(messages),
    stream,
  }
  if (!isReasoningModel(cfg.model)) body.temperature = cfg.temperature ?? 0.2
  if (cfg.maxTokens != null && Number.isFinite(cfg.maxTokens)) body.max_output_tokens = cfg.maxTokens
  return body
}

function proxyEndpoint(cfg: AiConfig): string {
  return (cfg.proxyURL || DEFAULT_AI_PROXY_URL).trim()
}

function modelsProxyEndpoint(cfg: AiConfig): string {
  const configured = proxyEndpoint(cfg)
  try {
    const url = new URL(configured)
    const pathname = url.pathname.replace(/\/+$/, '')
    if (pathname.endsWith('/proxy')) url.pathname = `${pathname.slice(0, -'/proxy'.length)}/models`
    else if (!pathname.endsWith('/models')) url.pathname = `${pathname}/models`
    else url.pathname = pathname
    return url.toString()
  } catch {
    return DEFAULT_AI_MODELS_PROXY_URL
  }
}

function serializableHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => { result[key] = value })
  return result
}

/**
 * 统一发送请求。自动模式只在浏览器拿不到 HTTP 响应（典型为 CORS）时回退到中转，
 * 不会掩盖上游已经明确返回的 401/404/429 等配置问题。
 */
async function sendAiRequest(
  cfg: AiConfig,
  mode: 'chat' | 'responses',
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const targets = endpointCandidates(cfg.baseURL, mode === 'responses' ? '/responses' : '/chat/completions')
  const headers = requestHeaders(cfg)
  const direct = (target: string) => fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })
  const throughProxy = (target: string) => fetch(proxyEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, headers: serializableHeaders(headers), payload }),
    signal,
  })

  const transport = cfg.transport ?? 'auto'
  if (transport === 'proxy') {
    if (targets.every(isLocalAiTarget)) throw new Error('本机、内网或 HTTP 接口不能使用应用中转，请切换“浏览器直连”或在桌面端运行。')
    return requestEndpointCandidates(targets, throughProxy)
  }
  if (transport === 'direct') return requestEndpointCandidates(targets, direct)
  try {
    return await requestEndpointCandidates(targets, direct)
  } catch (error) {
    // Fetch 在 CORS、DNS、TLS 等场景下只会抛 TypeError，浏览器不会暴露上游状态码。
    if (error instanceof TypeError) {
      if (targets.every(isLocalAiTarget)) throw new Error('本机、内网或 HTTP 接口无法从当前网页安全中转，请在桌面端运行，或切换“浏览器直连”并确认接口允许跨域。')
      return requestEndpointCandidates(targets, throughProxy)
    }
    throw error
  }
}

function responseText(data: unknown): string {
  const value = data as {
    choices?: { text?: string; message?: { content?: string | { text?: string; type?: string }[] } }[]
    output_text?: string
    output?: { content?: { text?: string; type?: string }[] }[]
  }
  const choiceText = value.choices?.[0]?.text
  if (typeof choiceText === 'string') return choiceText
  const content = value.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('')
  if (typeof value.output_text === 'string') return value.output_text
  return value.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? '').join('') ?? ''
}

async function sendWithCompatibility(
  cfg: AiConfig,
  mode: 'chat' | 'responses',
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  let current = payload
  const seen = new Set<string>()
  let lastResponse: Response | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await sendAiRequest(cfg, mode, current, signal)
    lastResponse = res
    if (res.ok) return res

    // 只在上游明确指出参数不支持时重试，避免把认证、余额、模型不存在等错误重复发送。
    const fallback = compatibilityPayload(mode, current, await errorTextFromResponse(res))
    if (!fallback) return res
    const signature = JSON.stringify(fallback)
    if (seen.has(signature)) return res
    seen.add(signature)
    current = fallback
  }
  return lastResponse!
}

/** 解析 OpenAI 兼容 SSE 的 data 行,返回增量文本;非数据行/[DONE]/解析失败返回 null */
export function sseDataDelta(line: string): string | null {
  const t = line.trim()
  if (!t.startsWith('data:')) return null
  const payload = t.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const j = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | { text?: string }[] } }[]
      delta?: string
      type?: string
    }
    const content = j.choices?.[0]?.delta?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('')
    if (typeof j.delta === 'string' && (!j.type || /output_text\.delta|text\.delta|content\.delta/i.test(j.type))) return j.delta
    return ''
  } catch {
    return null
  }
}

/** OpenAI 兼容 chat/completions 调用;失败抛出带原因的 Error */
export async function aiChat(cfg: AiConfig, messages: ChatMessage[], timeoutMs = 60000): Promise<string> {
  assertConfigured(cfg)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? timeoutMs)
  try {
    const mode = cfg.apiMode ?? 'chat'
    const payload = mode === 'responses' ? responsesBody(cfg, messages, false) : chatBody(cfg, messages, false)
    const res = await sendWithCompatibility(
      cfg,
      mode,
      payload,
      controller.signal,
    )
    if (!res.ok) await throwForStatus(res)
    const out = responseText(await res.json())
    if (!out) throw new Error('服务商返回了空回复')
    return out
  } catch (e) {
    throw mapFetchError(e)
  } finally {
    clearTimeout(timer)
  }
}

export interface AiStreamOptions {
  /** 每收到一段增量文本时回调 */
  onDelta?: (delta: string) => void
  /** 外部停止信号(停止生成按钮) */
  signal?: AbortSignal
  timeoutMs?: number
}

/** 流式 chat/completions;网关不支持 SSE 时自动退化为一次性读取。返回完整回复文本 */
export async function aiChatStream(cfg: AiConfig, messages: ChatMessage[], opts: AiStreamOptions = {}): Promise<string> {
  assertConfigured(cfg)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? cfg.timeoutMs ?? 120000)
  const onOuterAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onOuterAbort)
  const emit = (delta: string, full: string): string => {
    opts.onDelta?.(delta)
    return full + delta
  }
  try {
    const mode = cfg.apiMode ?? 'chat'
    const stream = cfg.stream !== false
    const payload = mode === 'responses' ? responsesBody(cfg, messages, stream) : chatBody(cfg, messages, stream)
    const res = await sendWithCompatibility(
      cfg,
      mode,
      payload,
      controller.signal,
    )
    if (!res.ok) await throwForStatus(res)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !res.body) {
      // 网关不支持流式:退化为一次性读取
      const out = responseText(await res.json())
      if (!out) throw new Error('服务商返回了空回复')
      return emit(out, '')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const d = sseDataDelta(line)
        if (d) full = emit(d, full)
      }
    }
    const tail = sseDataDelta(buf)
    if (tail) full = emit(tail, full)
    if (!full) throw new Error('服务商返回了空回复')
    return full
  } catch (e) {
    if (opts.signal?.aborted) throw new AiAbortedError()
    throw mapFetchError(e)
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/** 连接测试:发一条极短消息 */
export async function aiTest(cfg: AiConfig): Promise<string> {
  return aiChat(cfg, [{ role: 'user', content: '请回复:连接成功' }], 20000)
}

function parseModelOption(value: unknown): AiModelOption | null {
  if (typeof value === 'string' && value.trim()) return { id: value.trim(), name: value.trim() }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as {
    id?: unknown
    model?: unknown
    model_id?: unknown
    modelId?: unknown
    slug?: unknown
    name?: unknown
    display_name?: unknown
    displayName?: unknown
    owned_by?: unknown
    ownedBy?: unknown
  }
  const idValue = [item.id, item.model, item.model_id, item.modelId, item.slug, item.name].find((candidate) => typeof candidate === 'string' && candidate.trim())
  if (typeof idValue !== 'string') return null
  const id = idValue.trim()
  const nameValue = [item.name, item.display_name, item.displayName].find((candidate) => typeof candidate === 'string' && candidate.trim())
  const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : id
  const ownedBy = typeof item.owned_by === 'string' ? item.owned_by : typeof item.ownedBy === 'string' ? item.ownedBy : undefined
  return { id, name, ownedBy }
}

/** 兼容 OpenAI data、部分网关 models/items 以及直接数组格式。 */
export function parseAiModels(data: unknown): AiModelOption[] {
  const root = data as { data?: unknown; models?: unknown; items?: unknown }
  const candidates = Array.isArray(data) ? data : [root?.data, root?.models, root?.items].find(Array.isArray) ?? []
  const seen = new Set<string>()
  return (candidates as unknown[])
    .map(parseModelOption)
    .filter((item): item is AiModelOption => {
      if (!item || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
}

/** 从同一个 OpenAI-compatible 上游读取完整模型目录，自动复用直连/中转传输设置。 */
export async function aiModels(cfg: AiConfig, timeoutMs = 20000): Promise<AiModelOption[]> {
  if (!cfg.baseURL || !cfg.apiKey) throw new Error('读取模型列表需要先填写接口地址和 API Key')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? timeoutMs)
  const targets = endpointCandidates(cfg.baseURL, '/models')
  const headers = requestHeaders(cfg)
  const direct = (target: string) => fetch(target, { method: 'GET', headers, signal: controller.signal })
  const throughProxy = (target: string) => fetch(modelsProxyEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, headers: serializableHeaders(headers) }),
    signal: controller.signal,
  })
  try {
    const transport = cfg.transport ?? 'auto'
    let res: Response
    if (transport === 'proxy') {
      if (targets.every(isLocalAiTarget)) throw new Error('本机、内网或 HTTP 接口不能使用应用中转，请切换“浏览器直连”或在桌面端运行。')
      res = await requestEndpointCandidates(targets, throughProxy)
    } else if (transport === 'direct') res = await requestEndpointCandidates(targets, direct)
    else {
      try { res = await requestEndpointCandidates(targets, direct) } catch (error) {
        if (error instanceof TypeError) {
          if (targets.every(isLocalAiTarget)) throw new Error('本机、内网或 HTTP 接口无法从当前网页安全中转，请在桌面端运行，或切换“浏览器直连”并确认接口允许跨域。')
          res = await requestEndpointCandidates(targets, throughProxy)
        }
        else throw error
      }
    }
    if (!res.ok) await throwForStatus(res)
    const models = parseAiModels(await res.json())
    if (!models.length) throw new Error('上游返回了空模型列表，请检查接口是否支持 GET /models')
    return models
  } catch (error) {
    throw mapFetchError(error)
  } finally {
    clearTimeout(timer)
  }
}

/** 从模型回复中稳健地提取 JSON 对象 */
function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}


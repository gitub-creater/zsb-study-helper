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

/** 服务商返回非 2xx 时抛出带 HTTP 状态、原始错误和重试建议的 Error。 */
export async function throwForStatus(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  let detail = text.trim()
  try {
    const data = JSON.parse(text) as { error?: { message?: string; code?: string } | string; code?: string; message?: string; detail?: string }
    const errorDetail = typeof data.error === 'string' ? data.error : data.error?.message
    detail = errorDetail || data.message || data.detail || detail
    const code = typeof data.error === 'object' ? data.error?.code : data.code
    if (code) detail = `${detail}（${code}）`
  } catch {
    // 部分中转站返回纯文本，保留原文。
  }
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
  return baseURL.trim().replace(/\/+$/, '')
}

/** Base URL 可带 /v1；只在缺少具体路径时追加一次。 */
export function aiEndpoint(baseURL: string, mode: 'chat' | 'responses' = 'chat'): string {
  const base = normalizeAiBaseURL(baseURL)
  const path = mode === 'responses' ? '/responses' : '/chat/completions'
  if (base.endsWith(path)) return base
  return `${base}${path}`
}

function requestHeaders(cfg: AiConfig): Headers {
  const headers = new Headers({ ...(cfg.customHeaders ?? {}) })
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (cfg.apiKey && !headers.has('Authorization') && !headers.has('api-key') && !headers.has('x-api-key')) {
    headers.set('Authorization', `Bearer ${cfg.apiKey}`)
  }
  return headers
}

function chatBody(cfg: AiConfig, messages: ChatMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature ?? 0.2,
    stream,
  }
  if (cfg.maxTokens != null && Number.isFinite(cfg.maxTokens)) body.max_tokens = cfg.maxTokens
  return body
}

function responsesBody(cfg: AiConfig, messages: ChatMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    input: messages,
    temperature: cfg.temperature ?? 0.2,
    stream,
  }
  if (cfg.maxTokens != null && Number.isFinite(cfg.maxTokens)) body.max_output_tokens = cfg.maxTokens
  return body
}

function proxyEndpoint(cfg: AiConfig): string {
  return (cfg.proxyURL || DEFAULT_AI_PROXY_URL).trim()
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
  const target = aiEndpoint(cfg.baseURL, mode)
  const headers = requestHeaders(cfg)
  const direct = () => fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })
  const throughProxy = () => fetch(proxyEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, headers: serializableHeaders(headers), payload }),
    signal,
  })

  const transport = cfg.transport ?? 'auto'
  if (transport === 'proxy') return throughProxy()
  if (transport === 'direct') return direct()
  try {
    return await direct()
  } catch (error) {
    // Fetch 在 CORS、DNS、TLS 等场景下只会抛 TypeError，浏览器不会暴露上游状态码。
    if (error instanceof TypeError) return throughProxy()
    throw error
  }
}

function responseText(data: unknown): string {
  const value = data as {
    choices?: { message?: { content?: string | { text?: string }[] } }[]
    output_text?: string
    output?: { content?: { text?: string; type?: string }[] }[]
  }
  const content = value.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('')
  if (typeof value.output_text === 'string') return value.output_text
  return value.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? '').join('') ?? ''
}

/** 解析 OpenAI 兼容 SSE 的 data 行,返回增量文本;非数据行/[DONE]/解析失败返回 null */
export function sseDataDelta(line: string): string | null {
  const t = line.trim()
  if (!t.startsWith('data:')) return null
  const payload = t.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; delta?: string; type?: string }
    return j.choices?.[0]?.delta?.content ?? (typeof j.delta === 'string' ? j.delta : '')
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
    const res = await sendAiRequest(
      cfg,
      mode,
      mode === 'responses' ? responsesBody(cfg, messages, false) : chatBody(cfg, messages, false),
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
    const res = await sendAiRequest(
      cfg,
      mode,
      mode === 'responses' ? responsesBody(cfg, messages, stream) : chatBody(cfg, messages, stream),
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


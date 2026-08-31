// AI 服务层:豆包(火山方舟)/ DeepSeek / 通义千问 / 自定义 OpenAI 兼容网关
// 约束:密钥仅存本机由用户自行配置;三家均提供 OpenAI 兼容接口,统一走一个客户端;
//      浏览器直连可能遇到跨域,可改用 one-api/new-api 等兼容网关地址(选"自定义")

export type AiProviderId = 'doubao' | 'deepseek' | 'qwen' | 'custom'

export interface AiConfig {
  provider: AiProviderId
  baseURL: string
  apiKey: string
  model: string
  /** 思考程度:仅用于提示词分级与界面显示,不作为请求参数发送 */
  reasoningEffort?: 'low' | 'medium' | 'high'
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

/** 服务商返回非 2xx 时抛出带原因的 Error */
async function throwForStatus(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  if (res.status === 401) throw new Error('API Key 无效(401),请检查密钥')
  if (res.status === 404) throw new Error('接口地址或模型名不存在(404),请检查配置')
  if (res.status === 429) throw new Error('请求过于频繁或额度不足(429),请稍后重试')
  throw new Error(`服务商返回 ${res.status}:${text.slice(0, 160)}`)
}

function mapFetchError(e: unknown): unknown {
  if (e instanceof DOMException && e.name === 'AbortError') throw new Error('请求超时,请稍后重试或检查网络')
  if (e instanceof TypeError) {
    throw new Error('网络请求失败:可能是浏览器跨域限制。可在设置中改用支持跨域的网关地址(如 one-api)')
  }
  return e
}

function assertConfigured(cfg: AiConfig): void {
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    throw new Error('AI 服务未配置完整(接口地址 / API Key / 模型名)')
  }
}

/** 解析 OpenAI 兼容 SSE 的 data 行,返回增量文本;非数据行/[DONE]/解析失败返回 null */
export function sseDataDelta(line: string): string | null {
  const t = line.trim()
  if (!t.startsWith('data:')) return null
  const payload = t.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
    return j.choices?.[0]?.delta?.content ?? ''
  } catch {
    return null
  }
}

/** OpenAI 兼容 chat/completions 调用;失败抛出带原因的 Error */
export async function aiChat(cfg: AiConfig, messages: ChatMessage[], timeoutMs = 60000): Promise<string> {
  assertConfigured(cfg)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, stream: false }),
      signal: controller.signal,
    })
    if (!res.ok) await throwForStatus(res)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const out = data.choices?.[0]?.message?.content ?? ''
    if (!out) throw new Error('服务商返回了空回复')
    return out
  } catch (e) {
    throw mapFetchError(e)
  } finally {
    window.clearTimeout(timer)
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
  const timer = window.setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000)
  const onOuterAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onOuterAbort)
  const emit = (delta: string, full: string): string => {
    opts.onDelta?.(delta)
    return full + delta
  }
  try {
    const res = await fetch(`${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, stream: true }),
      signal: controller.signal,
    })
    if (!res.ok) await throwForStatus(res)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !res.body) {
      // 网关不支持流式:退化为一次性读取
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const out = data.choices?.[0]?.message?.content ?? ''
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
    window.clearTimeout(timer)
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


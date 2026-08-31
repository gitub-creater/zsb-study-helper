// AI 数学讲题辅助:图片校验与压缩、请求上下文窗口、最终答案提取、剪贴板
import type { ChatContentPart, ChatMessage } from '../services/ai'

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_MAX_COUNT = 4

/** 校验图片文件;返回 null 表示可用,否则返回给用户的错误提示 */
export function validateImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `不支持的图片格式:${file.name}(仅支持 PNG / JPG / WEBP)`
  if (file.size > IMAGE_MAX_BYTES) return `图片太大:${file.name}(超过 ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)}MB)`
  return null
}

/** 读取图片为 dataURL;超过 maxSide 时用 canvas 等比缩小,避免请求体过大 */
export function fileToDataUrl(file: File, maxSide = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`图片读取失败:${file.name}`))
    reader.onload = () => {
      const raw = String(reader.result)
      const img = new Image()
      img.onerror = () => resolve(raw)
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        if (scale >= 1) {
          resolve(raw)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(raw)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.9))
      }
      img.src = raw
    }
    reader.readAsDataURL(file)
  })
}

export interface ChatTurnLike {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

export interface WindowOptions {
  /** 参与请求的最大历史条数(不含系统提示词),默认 16 */
  maxMessages?: number
  /** 最近多少条用户消息保留图片,更早的消息图片降级为文字占位,默认 2 */
  imageWindow?: number
}

/** 组装请求消息:系统提示词在最前;历史保留最近 maxMessages 条;旧图片降级避免请求体无限增长 */
export function buildRequestMessages(system: string, history: ChatTurnLike[], opts: WindowOptions = {}): ChatMessage[] {
  const maxMessages = opts.maxMessages ?? 16
  const imageWindow = opts.imageWindow ?? 2
  const windowed = history.slice(-maxMessages)
  const userMsgCount = windowed.filter((m) => m.role === 'user').length
  let seenUsers = 0
  const msgs: ChatMessage[] = [{ role: 'system', content: system }]
  for (const m of windowed) {
    if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: m.text || '(空回复)' })
      continue
    }
    seenUsers++
    const keepImages = userMsgCount - seenUsers < imageWindow && (m.images?.length ?? 0) > 0
    if (!keepImages) {
      const note = (m.images?.length ?? 0) > 0 ? `${m.text}\n(此前消息附带的题目图片已省略)` : m.text
      msgs.push({ role: 'user', content: note.trim() || '(图片题)' })
      continue
    }
    const parts: ChatContentPart[] = []
    if (m.text.trim()) parts.push({ type: 'text', text: m.text })
    for (const url of m.images ?? []) parts.push({ type: 'image_url', image_url: { url } })
    if (parts.length === 0) parts.push({ type: 'text', text: '(图片题)' })
    msgs.push({ role: 'user', content: parts })
  }
  return msgs
}

/**
 * 计算删除某条消息所在的完整问答应移除的消息 id:
 * 一"题"= 一条用户消息 + 其后的所有回答;点回答上的删除会连同它的问题一起删。
 */
export function deleteTurnIds(msgs: { id: string; role: 'user' | 'assistant' }[], msgId: string): string[] {
  const idx = msgs.findIndex((m) => m.id === msgId)
  if (idx < 0) return []
  let start = idx
  if (msgs[idx].role === 'assistant') {
    while (start > 0 && msgs[start].role !== 'user') start--
  }
  let end = start
  while (end + 1 < msgs.length && msgs[end + 1].role === 'assistant') end++
  return msgs.slice(start, end + 1).map((m) => m.id)
}

const ANSWER_HEADING = /^(#{1,4})\s*最终答案\s*$|^\*\*最终答案\*\*\s*$/

/** 从回复中提取「最终答案」小节(按标题截取到下一个标题);找不到时回退为全文 */
export function extractFinalAnswer(text: string): string {
  const lines = text.split('\n')
  let start = -1
  let headingLen = 0
  for (let i = 0; i < lines.length; i++) {
    if (ANSWER_HEADING.test(lines[i].trim())) {
      start = i
      headingLen = lines[i].length
      break
    }
  }
  if (start < 0) return text.trim()
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,4}\s/.test(lines[i].trim())) break
    body.push(lines[i])
  }
  const out = body.join('\n').trim()
  return out || text.trim()
}

/**
 * 将 AI 的基础 Markdown 转为适合系统朗读的文字稿。
 * 不改变屏幕上的原始讲解；公式内容保留，让用户仍能听到变量和数字。
 */
export function toSpeechScript(text: string): string {
  return text
    .replace(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+] |\d+[.、)]\s+)/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 复制文本到剪贴板;非安全上下文回退 execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

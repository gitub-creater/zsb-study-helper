// AI 数学讲题对话框:复用 services/ai 现有接口(BYOK 密钥在设置页配置)与 skills/math 提示词
// 支持:文字题 / 图片题(上传·拖拽·粘贴)/ 流式输出 / 停止生成 / 复制答案 / 重新解析 / 追问上下文
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Modal, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { Markdown } from '../components/Markdown'
import { AI_PRESETS, aiChatStream, AiAbortedError } from '../services/ai'
import type { AiConfig, AiProviderId } from '../services/ai'
import { getSkill } from '../skills'
import { nav, uid } from '../lib/misc'
import { getSession } from '../lib/auth'
import {
  buildRequestMessages,
  copyText,
  deleteTurnIds,
  extractFinalAnswer,
  fileToDataUrl,
  IMAGE_ACCEPT,
  IMAGE_MAX_COUNT,
  validateImageFile,
} from '../lib/mathai'
import type { ChatTurnLike } from '../lib/mathai'

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** 本会话内的图片 dataURL(不落盘,刷新后丢失) */
  images?: string[]
  /** 历史消息的图片张数占位 */
  imageCount?: number
  error?: string
  stopped?: boolean
}

const EFFORT_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' }

function historyKey(): string {
  return `zsb_mathai_v1__${getSession()?.userId ?? 'local'}`
}

function loadHistory(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(historyKey())
    if (!raw) return []
    const arr = JSON.parse(raw) as ChatMsg[]
    if (!Array.isArray(arr)) return []
    return arr
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .slice(-100)
  } catch {
    return []
  }
}

function saveHistory(msgs: ChatMsg[]): void {
  try {
    const slim = msgs.slice(-100).map((m) => ({
      ...m,
      images: undefined,
      imageCount: m.images?.length ?? m.imageCount ?? 0,
    }))
    localStorage.setItem(historyKey(), JSON.stringify(slim))
  } catch {
    /* 存储空间不足时静默跳过,不影响对话 */
  }
}

interface TurnInfo {
  num: number
  user?: ChatMsg
  answers: ChatMsg[]
}

/** 取某条消息所在"题"(任务)的完整内容:题号 = 第几条提问 */
function turnInfo(msgs: ChatMsg[], msgId: string): TurnInfo | null {
  const ids = deleteTurnIds(msgs, msgId)
  if (!ids.length) return null
  const set = new Set(ids)
  const items = msgs.filter((m) => set.has(m.id))
  const startIdx = msgs.findIndex((m) => m.id === items[0].id)
  return {
    num: msgs.slice(0, startIdx + 1).filter((m) => m.role === 'user').length,
    user: items.find((m) => m.role === 'user'),
    answers: items.filter((m) => m.role === 'assistant'),
  }
}

/** 单题详情界面:完整展示这道题的问答,并提供复制 / 重新解析 / 删除 */
function TurnDetailModal({
  turn,
  busy,
  onClose,
  onCopy,
  onRegenerate,
  onDelete,
}: {
  turn: TurnInfo
  busy: boolean
  onClose: () => void
  onCopy: (m: ChatMsg) => void
  onRegenerate: (id: string) => void
  onDelete: (id: string) => void
}) {
  const last = turn.answers[turn.answers.length - 1]
  return (
    <Modal open title={`第 ${turn.num} 题 · 题目详情`} onClose={onClose} width={720} footer={
      <>
        <button className="btn" onClick={onClose}>关闭</button>
        {last && (
          <>
            <button className="btn" onClick={() => onCopy(last)}>
              <Icon name="copy" size={14} /> 复制答案
            </button>
            <button className="btn" disabled={busy} onClick={() => onRegenerate(last.id)}>
              <Icon name="refresh" size={14} /> 重新解析
            </button>
            <button className="btn btn-danger-solid" disabled={busy} onClick={() => onDelete(last.id)}>
              <Icon name="trash" size={14} /> 删除本题
            </button>
          </>
        )}
        {!last && turn.user && (
          <button className="btn btn-danger-solid" disabled={busy} onClick={() => onDelete(turn.user!.id)}>
            <Icon name="trash" size={14} /> 删除本题
          </button>
        )}
      </>
    }>
      {turn.user && (
        <div className="mathai-detail-q">
          {turn.user.images?.length ? (
            <div className="mathai-msgimgs">
              {turn.user.images.map((u, i) => (
                <img key={i} src={u} alt={`题目图片 ${i + 1}`} />
              ))}
            </div>
          ) : turn.user.imageCount ? (
            <span className="chip chip-blue"><Icon name="image" size={12} /> 图片题 ×{turn.user.imageCount}(图片仅本会话内可见)</span>
          ) : null}
          {turn.user.text && <div className="mathai-utext">{turn.user.text}</div>}
        </div>
      )}
      {turn.answers.map((a) => (
        <div key={a.id} className="mathai-detail-a">
          {a.stopped && (
            <div className="mathai-note"><Icon name="stop" size={12} /> {a.text ? '已停止生成,以下为部分内容' : '已停止生成'}</div>
          )}
          {a.error && (
            <div className="mathai-note error"><Icon name="close" size={12} /> {a.error}</div>
          )}
          {a.text && <Markdown text={a.text} />}
        </div>
      ))}
      {!turn.user && !turn.answers.length && <p className="muted">该题内容已不存在。</p>}
    </Modal>
  )
}

function MessageBubble({
  m,
  generating,
  busy,
  onRegenerate,
  onCopy,
  onDelete,
  onDetail,
  quickActions,
  onQuick,
}: {
  m: ChatMsg
  generating: boolean
  busy: boolean
  onRegenerate: (id: string) => void
  onCopy: (m: ChatMsg) => void
  onDelete: (id: string) => void
  onDetail: (id: string) => void
  quickActions?: { label: string; prompt: string }[]
  onQuick?: (prompt: string) => void
}) {
  if (m.role === 'user') {
    return (
      <div className="mathai-row user">
        <div className="mathai-bubble user">
          {m.images?.length ? (
            <div className="mathai-msgimgs">
              {m.images.map((u, i) => (
                <img key={i} src={u} alt={`题目图片 ${i + 1}`} />
              ))}
            </div>
          ) : m.imageCount ? (
            <span className="chip chip-blue" style={{ marginBottom: 4 }}>
              <Icon name="image" size={12} /> 图片题 ×{m.imageCount}
            </span>
          ) : null}
          {m.text && <div className="mathai-utext">{m.text}</div>}
          <div className="mathai-acts end">
            <button className="btn btn-xs" onClick={() => onDetail(m.id)}>
              <Icon name="search" size={12} /> 详情
            </button>
            <button className="btn btn-xs" aria-label="删除本题问答" title="删除本题问答" onClick={() => onDelete(m.id)}>
              <Icon name="trash" size={12} /> 删除
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="mathai-row ai">
      <div className="mathai-avatar" aria-hidden="true">
        <Icon name="math" size={15} />
      </div>
      <div className="mathai-bubble ai">
        {generating && !m.text ? (
          <div className="mathai-typing" role="status" aria-label="正在生成">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <Markdown text={m.text} />
        )}
        {m.stopped && (
          <div className="mathai-note">
            <Icon name="stop" size={12} /> {m.text ? '已停止生成,以上为部分内容' : '已停止生成,未收到内容'}
          </div>
        )}
        {m.error && (
          <div className="mathai-note error">
            <Icon name="close" size={12} /> {m.error}
          </div>
        )}
        {m.text && !generating && (
          <div className="mathai-acts">
            <button className="btn btn-xs" onClick={() => onDetail(m.id)}>
              <Icon name="search" size={12} /> 详情
            </button>
            <button className="btn btn-xs" onClick={() => onCopy(m)}>
              <Icon name="copy" size={13} /> 复制答案
            </button>
            <button className="btn btn-xs" disabled={busy} onClick={() => onRegenerate(m.id)}>
              <Icon name="refresh" size={13} /> 重新解析
            </button>
            <button className="btn btn-xs" aria-label="删除本题问答" title="删除本题问答(连同题目)" disabled={busy} onClick={() => onDelete(m.id)}>
              <Icon name="trash" size={12} /> 删除
            </button>
          </div>
        )}
        {quickActions && !busy && (
          <div className="mathai-quick">
            {quickActions.map((q) => (
              <button key={q.label} className="btn btn-xs" onClick={() => onQuick?.(q.prompt)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function AiMathPage() {
  const { state } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()
  const skill = getSkill('math')

  const ai = state.settings.ai
  const effort = ai?.reasoningEffort ?? 'medium'
  const presetId = (ai?.provider as AiProviderId) ?? 'custom'
  const presetName = AI_PRESETS[presetId]?.name ?? ai?.provider ?? '自定义'
  const configured = !!(ai?.baseURL && ai?.apiKey && ai?.model)

  const [msgs, setMsgs] = useState<ChatMsg[]>(loadHistory)
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    saveHistory(msgs)
  }, [msgs])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  const warnNoConfig = useCallback(() => {
    toast('请先在「设置 → AI 服务」配置接口地址、API Key 和模型名', { kind: 'error' })
  }, [toast])

  const runTurn = useCallback(
    async (history: ChatMsg[]) => {
      if (!configured || !ai) {
        warnNoConfig()
        return
      }
      const cfg: AiConfig = { provider: presetId, baseURL: ai.baseURL, apiKey: ai.apiKey, model: ai.model }
      const aid = uid('m')
      setMsgs([...history, { id: aid, role: 'assistant', text: '' }])
      setBusy(true)
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const turns: ChatTurnLike[] = history.map((m) => ({ role: m.role, text: m.text, images: m.images }))
        const req = buildRequestMessages(skill.buildSystemPrompt({ reasoningLevel: effort }), turns)
        const full = await aiChatStream(cfg, req, {
          signal: ac.signal,
          onDelta: (d) =>
            setMsgs((prev) => prev.map((m) => (m.id === aid ? { ...m, text: m.text + d } : m))),
        })
        setMsgs((prev) => prev.map((m) => (m.id === aid ? { ...m, text: full } : m)))
      } catch (e) {
        if (e instanceof AiAbortedError) {
          setMsgs((prev) => prev.map((m) => (m.id === aid ? { ...m, stopped: true } : m)))
        } else {
          const msg = e instanceof Error ? e.message : '生成失败,请稍后重试'
          setMsgs((prev) => prev.map((m) => (m.id === aid ? { ...m, error: msg } : m)))
        }
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [ai, configured, presetId, effort, skill, warnNoConfig]
  )

  const handleSend = () => {
    if (busy) return
    const text = input.trim()
    const blocked = skill.guard?.(text, images.length)
    if (blocked) {
      toast(blocked, { kind: 'error' })
      return
    }
    if (!configured) {
      warnNoConfig()
      return
    }
    const userMsg: ChatMsg = { id: uid('m'), role: 'user', text, images: images.length ? [...images] : undefined }
    setInput('')
    setImages([])
    void runTurn([...msgs, userMsg])
  }

  const regenerate = (aid: string) => {
    if (busy) return
    const idx = msgs.findIndex((m) => m.id === aid)
    if (idx < 0) return
    void runTurn(msgs.slice(0, idx))
  }

  const stop = () => abortRef.current?.abort()

  const addFiles = async (files: File[]) => {
    const added: string[] = []
    for (const f of files) {
      const err = validateImageFile(f)
      if (err) {
        toast(err, { kind: 'error' })
        continue
      }
      try {
        added.push(await fileToDataUrl(f))
      } catch (e) {
        toast(e instanceof Error ? e.message : '图片读取失败', { kind: 'error' })
      }
    }
    if (!added.length) return
    setImages((prev) => {
      const next = [...prev, ...added].slice(0, IMAGE_MAX_COUNT)
      if (next.length < prev.length + added.length) toast(`每条消息最多 ${IMAGE_MAX_COUNT} 张图片`, { kind: 'error' })
      return next
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length) void addFiles(files)
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const clearChat = async () => {
    if (busy) {
      toast('请先停止生成再清空对话', { kind: 'error' })
      return
    }
    if (!msgs.length) return
    const ok = await confirm({
      title: '清空对话?',
      desc: '当前的所有问答记录会被删除,无法恢复。',
      danger: true,
      confirmText: '清空',
    })
    if (ok) setMsgs([])
  }

  const copyAnswer = async (m: ChatMsg) => {
    const ok = await copyText(extractFinalAnswer(m.text) || m.text)
    toast(ok ? '最终答案已复制到剪贴板' : '复制失败,请手动选择文本复制', { kind: ok ? 'success' : 'error' })
  }

  /** 删除一整题的问答(问题 + 回答/追问);6 秒内可撤销 */
  const deleteTurn = (msgId: string) => {
    if (busy) {
      toast('请先停止生成再删除', { kind: 'error' })
      return
    }
    const ids = new Set(deleteTurnIds(msgs, msgId))
    if (!ids.size) return
    const at = msgs.findIndex((m) => ids.has(m.id))
    const removed = msgs.filter((m) => ids.has(m.id))
    setMsgs(msgs.filter((m) => !ids.has(m.id)))
    toast(`已删除 ${removed.length} 条问答记录`, {
      kind: 'success',
      duration: 6000,
      action: {
        label: '撤销',
        onClick: () => {
          setMsgs((prev) => {
            const next = [...prev]
            next.splice(Math.min(at, next.length), 0, ...removed)
            return next
          })
        },
      },
    })
  }

  const useQuick = (prompt: string) => {
    setInput(prompt)
    taRef.current?.focus()
  }

  /** 从详情界面删除本题:删除后关闭详情 */
  const deleteFromDetail = (msgId: string) => {
    setDetailId(null)
    deleteTurn(msgId)
  }

  const detail = detailId ? turnInfo(msgs, detailId) : null
  const lastId = msgs[msgs.length - 1]?.id

  return (
    <div
      className="mathai"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      {dragging && (
        <div className="mathai-droptip">
          <Icon name="upload" size={22} />
          松开添加题目图片
        </div>
      )}

      <div className="mathai-list" ref={listRef}>
        {msgs.length === 0 ? (
          <div className="mathai-empty">
            <Mascot mood="think" size={72} />
            <h3>{skill.name}</h3>
            <p>{skill.tagline}</p>
            <div className="mathai-quick">
              {skill.quickActions.map((q) => (
                <button key={q.label} className="btn btn-sm" disabled={busy} onClick={() => useQuick(q.prompt)}>
                  {q.label}
                </button>
              ))}
            </div>
            <p className="fs12 muted">点击图片按钮上传题目照片,或把截图拖进对话框、直接 Ctrl+V 粘贴</p>
            {!configured && <p className="fs12" style={{ color: 'var(--coral-deep)' }}>尚未配置 AI 服务,请先到「设置」填写接口与密钥</p>}
          </div>
        ) : (
          msgs.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              busy={busy}
              generating={busy && m.id === lastId && m.role === 'assistant'}
              onRegenerate={regenerate}
              onCopy={copyAnswer}
              onDelete={deleteTurn}
              onDetail={setDetailId}
              quickActions={m.id === lastId && m.role === 'assistant' && !m.error ? skill.quickActions : undefined}
              onQuick={useQuick}
            />
          ))
        )}
      </div>

      {detail && (
        <TurnDetailModal
          turn={detail}
          busy={busy}
          onClose={() => setDetailId(null)}
          onCopy={copyAnswer}
          onRegenerate={regenerate}
          onDelete={deleteFromDetail}
        />
      )}

      <div className="mathai-composer">
        {images.length > 0 && (
          <div className="mathai-thumbs">
            {images.map((url, i) => (
              <div key={i} className="mathai-thumb">
                <img src={url} alt={`待发送题目图片 ${i + 1}`} />
                <button
                  type="button"
                  className="mathai-thumb-x"
                  aria-label={`移除图片 ${i + 1}`}
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mathai-inputrow">
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            aria-label="上传题目图片"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="image" size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? [])
              if (fs.length) void addFiles(fs)
              e.target.value = ''
            }}
          />
          <textarea
            ref={taRef}
            className="input mathai-input"
            placeholder="输入数学题,如:求 lim(x→0) sin3x/tan5x;也可上传或粘贴题目图片"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          {busy ? (
            <button type="button" className="btn btn-danger-solid" aria-label="停止生成" onClick={stop}>
              <Icon name="stop" size={14} /> 停止
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              aria-label="发送"
              disabled={!input.trim() && images.length === 0}
              onClick={handleSend}
            >
              <Icon name="send" size={16} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            aria-label="清空对话"
            disabled={busy || msgs.length === 0}
            onClick={clearChat}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
        <div className="mathai-foot">
          <span className="fs12 muted">AI 可能出错,重要结论请自行验算</span>
          <button type="button" className="mathai-status" onClick={() => nav('settings')} aria-label="打开 AI 设置">
            <span className={`mathai-dot${configured ? ' on' : ''}`} />
            {configured
              ? `${presetName} · ${ai!.model} · 思考程度:${EFFORT_LABEL[effort] ?? effort}`
              : 'AI 未配置 · 点击前往设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

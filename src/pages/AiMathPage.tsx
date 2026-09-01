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
import { BrowserSpeechController, SPEECH_RATES } from '../services/tts'
import type { SpeechPlaybackState, SpeechRate, SpeechSentence, SpeechVoiceOption } from '../services/tts'
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
  toSpeechScript,
  validateImageFile,
} from '../lib/mathai'
import type { ChatTurnLike } from '../lib/mathai'
import type { SpeechSettings } from '../types'

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

interface SpeechUiState {
  messageId: string | null
  playback: SpeechPlaybackState
  sentence: SpeechSentence | null
  error: string | null
}

type SpeechPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

const INITIAL_SPEECH_UI: SpeechUiState = {
  messageId: null,
  playback: 'idle',
  sentence: null,
  error: null,
}

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

function SpeechControls({
  messageId,
  text,
  supported,
  voices,
  settings,
  speech,
  onRead,
  onPause,
  onResume,
  onStop,
  onReplay,
  onSettingsChange,
  onRefreshVoices,
  permission,
}: {
  messageId: string
  text: string
  supported: boolean
  voices: SpeechVoiceOption[]
  settings: SpeechSettings
  speech: SpeechUiState
  onRead: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onReplay: () => void
  onSettingsChange: (patch: Partial<SpeechSettings>) => void
  onRefreshVoices: () => void
  permission: SpeechPermissionState
}) {
  const active = speech.messageId === messageId
  const playback = active ? speech.playback : 'idle'
  const speechEnabled = settings.enabled !== false
  const disabled = !speechEnabled || !supported || !toSpeechScript(text)
  const hasNatural = voices.some((voice) => voice.isNatural)

  return (
    <section className={`mathai-speech${active ? ' is-active' : ''}`} aria-label="讲解朗读控制">
      <div className="mathai-speech-head">
        <span className="mathai-speech-title"><Icon name={speechEnabled ? 'volume' : 'volumeOff'} size={15} /> 讲解朗读</span>
        <button
          type="button"
          className={`btn btn-icon btn-ghost${speechEnabled ? ' is-active' : ''}`}
          aria-label={speechEnabled ? '关闭讲解朗读' : '开启讲解朗读'}
          title={speechEnabled ? '关闭讲解朗读' : '开启讲解朗读'}
          aria-pressed={speechEnabled}
          onClick={() => onSettingsChange({ enabled: !speechEnabled })}
        >
          <Icon name={speechEnabled ? 'volume' : 'volumeOff'} size={16} />
        </button>
        {active && playback !== 'idle' && playback !== 'unsupported' && (
          <span className={`mathai-speech-state is-${playback}`} aria-live="polite">
            {playback === 'speaking' ? '正在朗读' : playback === 'paused' ? '已暂停' : '朗读异常'}
          </span>
        )}
      </div>

      <label className="mathai-speech-switch">
        <input
          type="checkbox"
          checked={speechEnabled}
          onChange={(event) => onSettingsChange({ enabled: event.target.checked })}
        />
        <span>启用语音朗读</span>
      </label>

      <div className="mathai-speech-actions" aria-label="朗读操作">
        <button type="button" className="btn btn-xs" disabled={disabled} onClick={onRead}>
          <Icon name="play" size={13} /> 朗读
        </button>
        <button type="button" className="btn btn-xs" disabled={disabled || playback !== 'speaking'} onClick={onPause}>
          <Icon name="pause" size={13} /> 暂停
        </button>
        <button type="button" className="btn btn-xs" disabled={disabled || playback !== 'paused'} onClick={onResume}>
          <Icon name="play" size={13} /> 继续
        </button>
        <button type="button" className="btn btn-xs" disabled={disabled || (playback !== 'speaking' && playback !== 'paused')} onClick={onStop}>
          <Icon name="stop" size={12} /> 停止
        </button>
        <button type="button" className="btn btn-xs" disabled={disabled} onClick={onReplay}>
          <Icon name="refresh" size={13} /> 重新播放
        </button>
      </div>

      <div className="mathai-speech-options">
        <label>
          <span>语速</span>
          <select
            value={String(settings.rate)}
            disabled={!speechEnabled || !supported}
            onChange={(event) => onSettingsChange({ rate: Number(event.target.value) as SpeechRate })}
          >
            {SPEECH_RATES.map((rate) => <option key={rate} value={rate}>{rate} 倍</option>)}
          </select>
        </label>
        <label className="mathai-speech-voice">
          <span>声音</span>
          <select
            value={settings.voiceURI ?? ''}
            disabled={!speechEnabled || !supported}
            onChange={(event) => {
              const voiceURI = event.target.value || undefined
              const selected = voices.find((voice) => voice.id === voiceURI)
              onSettingsChange({ voiceURI, voiceName: selected?.name })
            }}
          >
            <option value="">优先自然音色（系统自动）</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>{voice.name}（{voice.lang}）{voice.isNatural ? ' · 自然音色' : voice.isMandarin ? ' · 普通话' : ''}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-xs btn-icon btn-ghost"
          aria-label="刷新可用声音"
          title="刷新可用声音"
          disabled={!speechEnabled || !supported}
          onClick={onRefreshVoices}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {!speechEnabled && (
        <p className="mathai-speech-note" role="status">
          语音朗读已关闭。文字讲解会继续保留；重新开启后即可朗读。
        </p>
      )}
      {speechEnabled && !supported && (
        <p className="mathai-speech-note" role="status">
          当前设备不支持语音朗读，文字讲解可继续正常使用。
        </p>
      )}
      {speechEnabled && supported && permission === 'default' && (
        <p className="mathai-speech-note" role="status">语音权限尚未验证。首次点击“朗读”后，浏览器会按设备规则尝试播放；若被拦截，请允许本站媒体播放。</p>
      )}
      {speechEnabled && supported && permission === 'denied' && (
        <p className="mathai-speech-note" role="alert">语音播放被设备或浏览器拦截。请打开浏览器地址栏的网站设置，允许声音/媒体播放后返回重试；文字讲解不受影响。</p>
      )}
      {supported && voices.length > 0 && !hasNatural && (
        <p className="mathai-speech-note">
          当前设备未发现自然音色，将优先使用普通话音色；可在系统语音设置中安装中文在线/自然音色后刷新。
        </p>
      )}
      {active && speech.sentence && playback !== 'idle' && (
        <output className="mathai-speech-current" aria-live="polite">
          <span>正在讲解</span>
          <mark>{speech.sentence.text}</mark>
        </output>
      )}
      {active && speech.error && (
        <p className="mathai-speech-error" role="alert">
          <Icon name="close" size={13} /> {speech.error}
        </p>
      )}
    </section>
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
  speechSupported,
  speechVoices,
  speechSettings,
  speech,
  onSpeechRead,
  onSpeechPause,
  onSpeechResume,
  onSpeechStop,
  onSpeechReplay,
  onSpeechSettingsChange,
  onRefreshSpeechVoices,
  speechPermission,
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
  speechSupported: boolean
  speechVoices: SpeechVoiceOption[]
  speechSettings: SpeechSettings
  speech: SpeechUiState
  onSpeechRead: (m: ChatMsg) => void
  onSpeechPause: () => void
  onSpeechResume: () => void
  onSpeechStop: () => void
  onSpeechReplay: (m: ChatMsg) => void
  onSpeechSettingsChange: (patch: Partial<SpeechSettings>) => void
  onRefreshSpeechVoices: () => void
  speechPermission: SpeechPermissionState
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
          <Markdown
            text={m.text}
            activeSpeechSentence={speech.messageId === m.id && speech.playback !== 'idle' ? speech.sentence?.text : null}
          />
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
          <>
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
            <SpeechControls
              messageId={m.id}
              text={m.text}
              supported={speechSupported}
              voices={speechVoices}
              settings={speechSettings}
              speech={speech}
              onRead={() => onSpeechRead(m)}
              onPause={onSpeechPause}
              onResume={onSpeechResume}
              onStop={onSpeechStop}
              onReplay={() => onSpeechReplay(m)}
              onSettingsChange={onSpeechSettingsChange}
              onRefreshVoices={onRefreshSpeechVoices}
              permission={speechPermission}
            />
          </>
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
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()
  const skill = getSkill('math')

  const ai = state.settings.ai
  const effort = ai?.reasoningEffort ?? 'medium'
  const presetId = (ai?.provider as AiProviderId) ?? 'custom'
  const presetName = AI_PRESETS[presetId]?.name ?? ai?.provider ?? '自定义'
  const configured = !!(ai?.baseURL && ai?.apiKey && ai?.model)
  const savedSpeech = state.settings.speech
  const savedRate = savedSpeech?.rate
  const speechRate: SpeechRate = SPEECH_RATES.includes(savedRate as SpeechRate) ? savedRate as SpeechRate : 1
  const speechSettings: SpeechSettings = { ...savedSpeech, enabled: savedSpeech?.enabled !== false, rate: speechRate, preferredLang: 'zh-CN' }

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
  const speechRef = useRef<BrowserSpeechController | null>(null)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [speechPermission, setSpeechPermission] = useState<SpeechPermissionState>('default')
  const [speechVoices, setSpeechVoices] = useState<SpeechVoiceOption[]>([])
  const [speech, setSpeech] = useState<SpeechUiState>(INITIAL_SPEECH_UI)

  useEffect(() => {
    saveHistory(msgs)
  }, [msgs])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  useEffect(() => {
    const controller = new BrowserSpeechController({
      onStateChange: (playback) => {
        setSpeech((prev) => ({ ...prev, playback }))
        if (playback === 'speaking') setSpeechPermission('granted')
      },
      onSentenceChange: (sentence) => setSpeech((prev) => ({ ...prev, sentence })),
      onVoicesChange: setSpeechVoices,
      onError: (error) => {
        setSpeech((prev) => ({ ...prev, error }))
        if (/禁止|拦截|权限/.test(error)) setSpeechPermission('denied')
      },
    })
    speechRef.current = controller
    setSpeechSupported(controller.supported)
    setSpeechPermission(controller.supported ? 'default' : 'unsupported')
    setSpeechVoices(controller.refreshVoices())
    return () => {
      if (speechRef.current === controller) speechRef.current = null
      controller.dispose()
    }
  }, [])

  const stopSpeech = useCallback(() => {
    speechRef.current?.stop()
    setSpeech((prev) => ({ ...prev, playback: 'idle', sentence: null, error: null }))
  }, [])

  const updateSpeechSettings = useCallback((patch: Partial<SpeechSettings>) => {
    if (patch.enabled === false) stopSpeech()
    dispatch({
      type: 'SET_SETTINGS',
      patch: {
        speech: { ...speechSettings, ...patch, preferredLang: 'zh-CN' },
      },
    })
  }, [dispatch, speechSettings, stopSpeech])

  const startSpeech = useCallback((message: ChatMsg) => {
    if (speechSettings.enabled === false) {
      setSpeech({
        messageId: message.id,
        playback: 'idle',
        sentence: null,
        error: '语音朗读当前已关闭。请先开启“启用语音朗读”后再播放，文字讲解仍可正常阅读。',
      })
      return
    }
    const script = toSpeechScript(message.text)
    setSpeech({ messageId: message.id, playback: 'idle', sentence: null, error: null })
    const controller = speechRef.current
    if (!controller) {
      setSpeech({
        messageId: message.id,
        playback: 'unsupported',
        sentence: null,
        error: '当前设备尚未初始化语音朗读，文字讲解可继续正常使用。',
      })
      return
    }
    controller.speak(script, {
      rate: speechSettings.rate,
      voiceId: speechSettings.voiceURI,
      voiceName: speechSettings.voiceName,
    })
  }, [speechSettings.enabled, speechSettings.rate, speechSettings.voiceURI, speechSettings.voiceName])

  // 从设置页关闭总开关时，也要立刻停止当前讲解。
  useEffect(() => {
    if (speechSettings.enabled === false) stopSpeech()
  }, [speechSettings.enabled, stopSpeech])

  const pauseSpeech = useCallback(() => {
    if (speechRef.current?.pause()) setSpeech((prev) => ({ ...prev, playback: 'paused' }))
  }, [])

  const resumeSpeech = useCallback(() => {
    if (speechRef.current?.resume()) setSpeech((prev) => ({ ...prev, playback: 'speaking' }))
  }, [])

  const refreshSpeechVoices = useCallback(() => {
    const voices = speechRef.current?.refreshVoices() ?? []
    setSpeechVoices(voices)
    toast(voices.length ? `已刷新 ${voices.length} 个可用声音` : '当前系统尚未返回可用声音，朗读时将尝试使用系统默认声音', {
      kind: voices.length ? 'success' : 'error',
    })
  }, [toast])

  /** 必须由点击事件直接触发，避免浏览器把定时器或异步回调当作自动播放拦截。 */
  const testSpeech = useCallback(() => {
    const controller = speechRef.current
    if (!controller) {
      setSpeech({ messageId: 'speech-preview', playback: 'unsupported', sentence: null, error: '当前设备尚未初始化语音朗读，请使用支持系统朗读的浏览器或应用。' })
      return
    }
    if (speechSettings.enabled === false) updateSpeechSettings({ enabled: true })
    setSpeech({ messageId: 'speech-preview', playback: 'idle', sentence: null, error: null })
    // 必须在点击事件内立即调用 speak；等待 voiceschanged 的异步回调会丢失
    // Android 浏览器的用户手势授权，导致 vivo 等设备静默拦截播放。
    const voices = controller.refreshVoices()
    if (voices.length > 0) setSpeechVoices(voices)
    const started = controller.speak('你好，这是专升本学习助手的语音播放测试。', {
      rate: speechSettings.rate,
      voiceId: speechSettings.voiceURI,
      voiceName: speechSettings.voiceName,
    })
    if (!started) toast('语音测试未能启动，请查看页面提示并检查浏览器声音设置', { kind: 'error' })
  }, [speechSettings.enabled, speechSettings.rate, speechSettings.voiceName, speechSettings.voiceURI, toast, updateSpeechSettings])

  const warnNoConfig = useCallback(() => {
    toast('请先在「设置 → AI 服务」配置接口地址、API Key 和模型名', { kind: 'error' })
  }, [toast])

  const runTurn = useCallback(
    async (history: ChatMsg[]) => {
      if (!configured || !ai) {
        warnNoConfig()
        return
      }
      const cfg: AiConfig = {
        provider: presetId,
        baseURL: ai.baseURL,
        apiKey: ai.apiKey,
        model: ai.model,
        transport: ai.transport,
        proxyURL: ai.proxyURL,
        reasoningEffort: ai.reasoningEffort,
        apiMode: ai.apiMode,
        timeoutMs: ai.timeoutMs,
        stream: ai.stream,
        customHeaders: ai.customHeaders,
        temperature: ai.temperature,
        maxTokens: ai.maxTokens,
      }
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
    stopSpeech()
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
    if (ok) {
      stopSpeech()
      setMsgs([])
    }
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
    if (speech.messageId && ids.has(speech.messageId)) stopSpeech()
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
      <div className="mathai-voice-bar" role="group" aria-label="AI 讲题声音控制">
        <span className="mathai-voice-label">
          <Icon name={speechSettings.enabled === false ? 'volumeOff' : 'volume'} size={16} />
          AI 讲题声音
          <small>{speechSettings.enabled === false ? '已关闭' : speechSupported ? '已开启' : '设备不支持'}</small>
        </span>
        <div className="spacer" />
        <button
          type="button"
          className={`btn btn-icon btn-ghost${speechSettings.enabled === false ? '' : ' is-active'}`}
          aria-label={speechSettings.enabled === false ? '开启 AI 讲题声音' : '关闭 AI 讲题声音'}
          title={speechSettings.enabled === false ? '开启 AI 讲题声音' : '关闭 AI 讲题声音'}
          aria-pressed={speechSettings.enabled !== false}
          onClick={() => updateSpeechSettings({ enabled: speechSettings.enabled === false })}
        >
          <Icon name={speechSettings.enabled === false ? 'volumeOff' : 'volume'} size={18} />
        </button>
        <button type="button" className="btn btn-sm" onClick={testSpeech} disabled={!speechSupported}>
          <Icon name="play" size={13} /> 测试声音
        </button>
      </div>
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
              speechSupported={speechSupported}
              speechVoices={speechVoices}
              speechSettings={speechSettings}
              speech={speech}
              onSpeechRead={startSpeech}
              onSpeechPause={pauseSpeech}
              onSpeechResume={resumeSpeech}
              onSpeechStop={stopSpeech}
              onSpeechReplay={startSpeech}
              onSpeechSettingsChange={updateSpeechSettings}
              onRefreshSpeechVoices={refreshSpeechVoices}
              speechPermission={speechPermission}
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

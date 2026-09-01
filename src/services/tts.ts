// 统一的讲解朗读控制。使用 Web Speech API，并优先选择系统提供的普通话自然音色。
// 语音内容由传入的文字稿生成，浏览器不支持时调用方应继续提供文字讲解。

export const SPEECH_RATES = [0.75, 1, 1.25, 1.5] as const

export type SpeechRate = (typeof SPEECH_RATES)[number]
export type SpeechPlaybackState = 'idle' | 'speaking' | 'paused' | 'unsupported' | 'error'

export interface SpeechVoiceOption {
  /** 用 voiceURI 优先生成，能跨一次 voiceschanged 稳定匹配。 */
  id: string
  name: string
  lang: string
  isMandarin: boolean
  /** 系统标注为 Online/Natural 或常见中文神经音色，优先级高于普通 SAPI 音色。 */
  isNatural: boolean
  isDefault: boolean
}

export interface SpeechSentence {
  index: number
  text: string
  /** 在传给 SpeechSynthesisUtterance 的文字中的起始位置。 */
  start: number
  end: number
}

export interface SpeechCallbacks {
  onStateChange?: (state: SpeechPlaybackState) => void
  onSentenceChange?: (sentence: SpeechSentence | null) => void
  onVoicesChange?: (voices: SpeechVoiceOption[]) => void
  onError?: (message: string) => void
}

export interface SpeechSpeakOptions {
  rate?: SpeechRate
  voiceId?: string
  /** voiceURI 在系统更新后变化时，作为可恢复的匹配条件。 */
  voiceName?: string
}

export interface SpeechSynthesisPort {
  speaking: boolean
  paused: boolean
  cancel: () => void
  getVoices: () => SpeechSynthesisVoice[]
  pause: () => void
  resume: () => void
  speak: (utterance: SpeechSynthesisUtterance) => void
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void
}

export interface SpeechEnvironment {
  synthesis?: SpeechSynthesisPort
  createUtterance?: (text: string) => SpeechSynthesisUtterance
}

type SpeechWindow = Window & {
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
  /** Older Android WebView/Chromium builds expose the Web Speech constructor with a prefix. */
  webkitSpeechSynthesis?: SpeechSynthesis
  webkitSpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
}

/**
 * Resolve both standard and legacy Web Speech names. Vivo's browser and older
 * Android WebViews can expose only the prefixed constructor, even though the
 * system TTS engine is installed and ready to use.
 */
export function browserSpeechEnvironment(): SpeechEnvironment {
  if (typeof window === 'undefined') return {}
  const browserWindow = window as SpeechWindow
  const synthesis = browserWindow.speechSynthesis ?? browserWindow.webkitSpeechSynthesis
  const Utterance = browserWindow.SpeechSynthesisUtterance ?? browserWindow.webkitSpeechSynthesisUtterance
  if (!synthesis || !Utterance) return {}
  return {
    synthesis: synthesis as SpeechSynthesisPort,
    createUtterance: (text) => new Utterance(text),
  }
}

function safeSpeechVoices(synthesis: SpeechSynthesisPort): SpeechSynthesisVoice[] {
  try {
    return synthesis.getVoices() ?? []
  } catch {
    return []
  }
}

/**
 * 某些移动设备（如 vivo、OPPO 等）的浏览器在页面初始化时 speechSynthesis API 可能未完全就绪，
 * 需要延迟检测并等待 voiceschanged 事件。此函数通过多次尝试和超时机制确保兼容性。
 */
export async function waitForSpeechSynthesis(timeout = 5000): Promise<SpeechEnvironment> {
  const env = browserSpeechEnvironment()
  if (!env.synthesis) return {}

  // 如果已经有可用声音，直接返回
  const initialVoices = safeSpeechVoices(env.synthesis)
  if (initialVoices && initialVoices.length > 0) return env

  // 等待 voiceschanged 事件或超时
  return new Promise((resolve) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      if (handler && env.synthesis!.removeEventListener) {
        env.synthesis!.removeEventListener('voiceschanged', handler)
      }
      // 超时后再次检查，某些设备可能静默加载完成
      const voices = safeSpeechVoices(env.synthesis!)
      if (voices && voices.length > 0) {
        resolve(env)
      } else {
        // 即使没有声音也返回环境，让用户看到提示而不是直接失败
        resolve(env)
      }
    }, timeout)

    const handler = () => {
      if (resolved) return
      const voices = safeSpeechVoices(env.synthesis!)
      if (voices && voices.length > 0) {
        resolved = true
        clearTimeout(timer)
        if (env.synthesis!.removeEventListener) {
          env.synthesis!.removeEventListener('voiceschanged', handler)
        }
        resolve(env)
      }
    }

    const synthesis = env.synthesis!
    if (synthesis.addEventListener) {
      synthesis.addEventListener('voiceschanged', handler)
      // 某些浏览器需要手动触发一次 getVoices 来激活 voiceschanged 事件
      setTimeout(() => {
        if (!resolved) {
          safeSpeechVoices(synthesis)
        }
      }, 100)
    } else {
      clearTimeout(timer)
      resolve(env)
    }
  })
}

function isMandarinLanguage(lang: string): boolean {
  const normalized = lang.toLowerCase()
  return normalized === 'zh-cn'
    || normalized === 'zh-hans'
    || normalized.startsWith('zh-cn-')
    || normalized.startsWith('zh-hans-')
    || normalized.startsWith('cmn')
}

// Edge/Chromium 在不同系统上返回的名称略有差异；这些是常见的中文神经音色命名。
// 未匹配到时仍保留普通话声音作为兜底，避免把朗读功能绑定到某一家浏览器。
const NATURAL_VOICE_PATTERNS = [
  /natural/i,
  /online/i,
  /neural/i,
  /xiaoxiao/i,
  /xiaoyi/i,
  /yunxi/i,
  /yunjian/i,
  /yunyang/i,
  /yunxia/i,
  /yunye/i,
  /晓晓|晓伊|云希|云健|云扬|云夏|云野/,
]

function isNaturalMandarinVoice(voice: Pick<SpeechSynthesisVoice, 'name' | 'voiceURI' | 'lang' | 'localService'>): boolean {
  if (!isMandarinLanguage(voice.lang)) return false
  if (voice.localService === false) return true
  const label = `${voice.name} ${voice.voiceURI}`
  return NATURAL_VOICE_PATTERNS.some((pattern) => pattern.test(label))
}

/** 持久化时使用的声音标识。voiceURI 缺失时退回名称和语言。 */
export function speechVoiceId(voice: Pick<SpeechSynthesisVoice, 'voiceURI' | 'name' | 'lang'>): string {
  return voice.voiceURI || `${voice.lang}::${voice.name}`
}

/** 可用声音按普通话自然音色、其他普通话、中文、系统默认、其余语言排序。 */
export function listSpeechVoices(voices: SpeechSynthesisVoice[]): SpeechVoiceOption[] {
  return voices
    .map((voice) => ({
      id: speechVoiceId(voice),
      name: voice.name,
      lang: voice.lang || '未知语言',
      isMandarin: isMandarinLanguage(voice.lang),
      isNatural: isNaturalMandarinVoice(voice),
      isDefault: voice.default,
    }))
    .sort((a, b) => {
      const rank = (voice: SpeechVoiceOption) => (
        voice.isNatural ? 0 : voice.isMandarin ? 1 : voice.lang.toLowerCase().startsWith('zh') ? 2 : voice.isDefault ? 3 : 4
      )
      return rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN')
    })
}

/** 优先用户指定音色；不存在时优先普通话自然音色，再回退到其他中文/系统默认。 */
export function resolveSpeechVoice(voices: SpeechSynthesisVoice[], selectedId?: string, selectedName?: string): SpeechSynthesisVoice | undefined {
  if (selectedId) {
    const selected = voices.find((voice) => speechVoiceId(voice) === selectedId)
    if (selected) return selected
  }
  if (selectedName) {
    const selected = voices.find((voice) => voice.name === selectedName)
    if (selected) return selected
  }
  return voices.find((voice) => isNaturalMandarinVoice(voice))
    ?? voices.find((voice) => isMandarinLanguage(voice.lang))
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('zh'))
    ?? voices.find((voice) => voice.default)
    ?? voices[0]
}

/**
 * 按中文和英文常用句末标点分句。start/end 与原文本对齐，供 boundary 事件定位高亮。
 * 逗号不作为切分点，以避免公式推导等短语被过度切碎。
 */
export function splitSpeechSentences(text: string): SpeechSentence[] {
  const sentences: SpeechSentence[] = []
  const boundary = /[。！？!?；;]+(?:["』」）】》'"]*)|\n+/g
  let rawStart = 0
  let match: RegExpExecArray | null

  const push = (rawEnd: number) => {
    const raw = text.slice(rawStart, rawEnd)
    const leading = raw.match(/^\s*/)?.[0].length ?? 0
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0
    const start = rawStart + leading
    const end = rawEnd - trailing
    const content = text.slice(start, end)
    if (content) sentences.push({ index: sentences.length, text: content, start, end })
  }

  while ((match = boundary.exec(text)) !== null) {
    push(match.index + match[0].length)
    rawStart = match.index + match[0].length
  }
  push(text.length)
  return sentences
}

/** 浏览器 TTS 错误转成可直接展示的中文说明。 */
export function speechErrorMessage(error?: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '系统已禁止语音朗读。请在浏览器或设备设置中允许媒体播放后重试，文字讲解仍可正常使用。'
    case 'voice-unavailable':
      return '所选音色当前不可用，已保留文字讲解。请刷新可用声音或选择其他音色后重试。'
    case 'network':
      return '系统语音服务暂不可用，已保留文字讲解。请检查网络或更换设备音色后重试。'
    default:
      return '语音朗读未能启动，已保留文字讲解。请刷新可用声音或稍后重试。'
  }
}

export const SPEECH_UNSUPPORTED_MESSAGE = '当前设备不支持语音朗读，文字讲解可继续正常使用。'

/** 初始探测失败后给用户可操作的重试提示，而不是直接宣判设备不支持。 */
export const SPEECH_RETRY_MESSAGE =
  '暂未获取到系统语音能力。点击「朗读」或「测试声音」会自动重新检测；部分手机自带浏览器（如 vivo 浏览器）会屏蔽网页朗读，可改用 Chrome/Edge 打开本页。文字讲解不受影响。'

/**
 * 对 Web Speech API 的小封装：一条讲解使用一个 utterance，因此暂停/继续不会丢失位置。
 * 不把状态保存在该对象中，页面可自行将语速和音色持久化到学习状态。
 */
export class BrowserSpeechController {
  private synthesis?: SpeechSynthesisPort
  private createUtterance?: (text: string) => SpeechSynthesisUtterance
  private readonly callbacks: SpeechCallbacks
  private utterance: SpeechSynthesisUtterance | null = null
  private sentences: SpeechSentence[] = []
  private run = 0
  private disposed = false
  private voicesHandler: (() => void) | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private voicesLoadAttempted = false

  constructor(callbacks: SpeechCallbacks = {}, environment: SpeechEnvironment = browserSpeechEnvironment()) {
    this.callbacks = callbacks
    this.applyEnvironment(environment)
  }

  get supported(): boolean {
    return !!this.synthesis && !!this.createUtterance
  }

  private applyEnvironment(environment: SpeechEnvironment): void {
    this.synthesis = environment.synthesis
    this.createUtterance = environment.createUtterance
    if (this.synthesis?.addEventListener && !this.voicesHandler) {
      this.voicesHandler = () => this.callbacks.onVoicesChange?.(this.voices())
      this.synthesis.addEventListener('voiceschanged', this.voicesHandler)
    }
  }

  /**
   * 重新探测浏览器语音能力。部分手机浏览器（vivo、OPPO 等）在页面加载后
   * 才懒注入 speechSynthesis，初始检测失败不代表真的不支持；每次用户手势
   * 或页面回到前台时调用一次，探测到 API 出现即可恢复朗读。
   */
  probeSupport(environment: SpeechEnvironment = browserSpeechEnvironment()): boolean {
    if (this.disposed) return false
    if (this.supported) return true
    if (!environment.synthesis || !environment.createUtterance) return false
    this.applyEnvironment(environment)
    this.voicesLoadAttempted = false
    return true
  }

  voices(): SpeechVoiceOption[] {
    if (!this.supported) return []
    // 某些设备需要多次调用 getVoices 才能返回结果
    if (!this.voicesLoadAttempted) {
      this.voicesLoadAttempted = true
      // 触发加载
      try { this.synthesis!.getVoices() } catch { /* 语音服务尚未就绪 */ }
    }
    try {
      return listSpeechVoices(this.synthesis!.getVoices() ?? [])
    } catch {
      // A few Android WebViews expose getVoices before the speech service is ready.
      return []
    }
  }

  refreshVoices(): SpeechVoiceOption[] {
    this.voicesLoadAttempted = false
    const voices = this.voices()
    this.callbacks.onVoicesChange?.(voices)
    return voices
  }

  /**
   * 异步等待语音引擎就绪。某些移动设备需要延迟加载。
   */
  async ensureReady(timeout = 3000): Promise<boolean> {
    if (!this.supported) return false
    
    const voices = this.voicesForSynthesis()
    if (voices && voices.length > 0) return true

    return new Promise((resolve) => {
      let resolved = false
      const timer = setTimeout(() => {
        if (resolved) return
        resolved = true
        if (handler && this.synthesis!.removeEventListener) {
          this.synthesis!.removeEventListener('voiceschanged', handler)
        }
        const finalVoices = this.voicesForSynthesis()
        resolve(finalVoices && finalVoices.length > 0)
      }, timeout)

      const handler = () => {
        if (resolved) return
        const currentVoices = this.voicesForSynthesis()
        if (currentVoices && currentVoices.length > 0) {
          resolved = true
          clearTimeout(timer)
          if (this.synthesis!.removeEventListener) {
            this.synthesis!.removeEventListener('voiceschanged', handler)
          }
          this.callbacks.onVoicesChange?.(this.voices())
          resolve(true)
        }
      }

      if (this.synthesis!.addEventListener) {
        this.synthesis!.addEventListener('voiceschanged', handler)
        // 多次触发以激活某些懒加载的实现
        setTimeout(() => { this.voicesForSynthesis() }, 50)
        setTimeout(() => { this.voicesForSynthesis() }, 200)
      } else {
        clearTimeout(timer)
        resolve(false)
      }
    })
  }

  speak(text: string, options: SpeechSpeakOptions = {}): boolean {
    if (!this.supported || this.disposed) {
      this.emitUnsupported()
      return false
    }
    // 仅移除首尾空白，保留中间换行及字符位置，确保 boundary 的 charIndex 可定位当前句。
    const script = text.trim()
    if (!script) {
      this.callbacks.onError?.('没有可朗读的文字内容。')
      return false
    }

    this.stop()
    const run = ++this.run
    const utterance = this.createUtterance!(script)
    const selectedVoice = resolveSpeechVoice(this.voicesForSynthesis(), options.voiceId, options.voiceName)
    if (selectedVoice) {
      utterance.voice = selectedVoice
      utterance.lang = selectedVoice.lang || 'zh-CN'
    } else {
      utterance.lang = 'zh-CN'
    }
    utterance.rate = options.rate ?? 1
    utterance.pitch = 1
    utterance.volume = 1
    this.sentences = splitSpeechSentences(script)
    this.utterance = utterance

    utterance.onstart = () => {
      if (this.isCurrentRun(run)) {
        this.clearStartTimer()
        this.callbacks.onStateChange?.('speaking')
        this.callbacks.onSentenceChange?.(this.sentences[0] ?? null)
      }
    }
    utterance.onboundary = (event) => {
      if (!this.isCurrentRun(run)) return
      const charIndex = typeof event.charIndex === 'number' ? event.charIndex : 0
      const sentence = this.sentenceAt(charIndex)
      if (sentence) this.callbacks.onSentenceChange?.(sentence)
    }
    utterance.onpause = () => {
      if (this.isCurrentRun(run)) this.callbacks.onStateChange?.('paused')
    }
    utterance.onresume = () => {
      if (this.isCurrentRun(run)) this.callbacks.onStateChange?.('speaking')
    }
    utterance.onend = () => {
      if (!this.isCurrentRun(run)) return
      this.utterance = null
      this.callbacks.onStateChange?.('idle')
      this.callbacks.onSentenceChange?.(null)
    }
    utterance.onerror = (event) => {
      if (!this.isCurrentRun(run)) return
      this.utterance = null
      this.clearStartTimer()
      const error = (event as SpeechSynthesisErrorEvent).error
      // cancel/interrupted 来自用户主动停止或切换讲解，不应把正常控制显示成错误。
      if (error === 'canceled' || error === 'interrupted') return
      this.callbacks.onStateChange?.('error')
      this.callbacks.onSentenceChange?.(null)
      this.callbacks.onError?.(speechErrorMessage(error))
    }

    try {
      // Chromium/Electron 可能在页面切换、系统锁屏后把 speechSynthesis 留在
      // paused 状态；此时 speak() 不一定抛错，但不会真正出声。播放前主动唤醒，
      // 并在短时间没有进入 speaking 时再唤醒一次，覆盖该类静默失败。
      try { this.synthesis!.resume() } catch { /* 某些 WebView 未实现 resume */ }
      this.synthesis!.speak(utterance)
      this.startTimer = setTimeout(() => {
        this.startTimer = null
        if (!this.isCurrentRun(run) || this.synthesis!.speaking) return
        // 某些 Chromium 版本在 cancel() 后同一事件循环内首次 speak 会被吞掉；
        // 重新排队一次可恢复播放，同时仍保持原 utterance 的事件回调。
        try { this.synthesis!.cancel() } catch { /* ignore */ }
        try { this.synthesis!.resume() } catch { /* ignore */ }
        try {
          this.utterance = utterance
          this.synthesis!.speak(utterance)
        } catch { /* ignore */ }
      }, 350)
      return true
    } catch {
      if (this.isCurrentRun(run)) {
        this.utterance = null
        this.clearStartTimer()
        this.callbacks.onStateChange?.('error')
        this.callbacks.onSentenceChange?.(null)
        this.callbacks.onError?.(speechErrorMessage())
      }
      return false
    }
  }

  pause(): boolean {
    if (!this.supported || !this.utterance || !this.synthesis!.speaking || this.synthesis!.paused) return false
    try {
      this.synthesis!.pause()
      return true
    } catch {
      return false
    }
  }

  resume(): boolean {
    if (!this.supported || !this.utterance || !this.synthesis!.paused) return false
    try {
      this.synthesis!.resume()
      return true
    } catch {
      return false
    }
  }

  stop(notify = true): void {
    if (!this.supported) return
    this.run++
    this.utterance = null
    this.sentences = []
    this.clearStartTimer()
    try {
      this.synthesis!.cancel()
    } catch {
      // Partial Web Speech implementations can throw while their service is restarting.
    }
    if (notify) {
      this.callbacks.onStateChange?.('idle')
      this.callbacks.onSentenceChange?.(null)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.stop(false)
    this.disposed = true
    if (this.voicesHandler && this.synthesis?.removeEventListener) {
      this.synthesis.removeEventListener('voiceschanged', this.voicesHandler)
    }
  }

  private emitUnsupported(): void {
    this.callbacks.onStateChange?.('unsupported')
    this.callbacks.onSentenceChange?.(null)
    this.callbacks.onError?.(SPEECH_UNSUPPORTED_MESSAGE)
  }

  private clearStartTimer(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer)
      this.startTimer = null
    }
  }

  private voicesForSynthesis(): SpeechSynthesisVoice[] {
    try {
      return this.synthesis?.getVoices() ?? []
    } catch {
      return []
    }
  }

  private isCurrentRun(run: number): boolean {
    return !this.disposed && run === this.run
  }

  private sentenceAt(charIndex: number): SpeechSentence | null {
    return this.sentences.find((sentence) => charIndex >= sentence.start && charIndex < sentence.end)
      ?? this.sentences.find((sentence) => sentence.start >= charIndex)
      ?? this.sentences[this.sentences.length - 1]
      ?? null
  }
}

// 第三方 TTS/ASR 的预留接口继续保留；本次功能默认只启用上面的原生实现。
export interface TtsProvider {
  id: string
  synthesize(script: string, opts: { voice?: string; speed?: number }): Promise<ArrayBuffer>
}

export interface AsrProvider {
  id: string
  recognize(audio: ArrayBuffer): Promise<{ text: string; confidence: number }>
}

export const ttsProvider: TtsProvider | null = null
export const asrProvider: AsrProvider | null = null

import { describe, expect, it } from 'vitest'
import {
  BrowserSpeechController,
  listSpeechVoices,
  resolveSpeechVoice,
  SPEECH_UNSUPPORTED_MESSAGE,
  speechErrorMessage,
  splitSpeechSentences,
} from '../src/services/tts'
import type { SpeechEnvironment, SpeechSynthesisPort } from '../src/services/tts'
import { emptyState, normalizeState, reducer } from '../src/store/store'

type SpeechPreferences = { enabled: boolean; rate: 0.75 | 1 | 1.25 | 1.5 }

type FakeUtterance = SpeechSynthesisUtterance & { text: string }

function voice(name: string, lang: string, voiceURI: string, isDefault = false): SpeechSynthesisVoice {
  return { name, lang, voiceURI, default: isDefault, localService: true } as SpeechSynthesisVoice
}

function makeEnvironment() {
  const voices = [
    voice('English', 'en-US', 'en', true),
    voice('普通话', 'zh-CN', 'zh-cn'),
    voice('繁体中文', 'zh-TW', 'zh-tw'),
  ]
  let utterance: FakeUtterance | null = null
  let voicesChanged: (() => void) | undefined
  let cancelled = 0

  const synthesis: SpeechSynthesisPort = {
    speaking: false,
    paused: false,
    cancel: () => {
      synthesis.speaking = false
      synthesis.paused = false
      cancelled++
    },
    getVoices: () => voices,
    pause: () => {
      synthesis.paused = true
      utterance?.onpause?.(new Event('pause') as SpeechSynthesisEvent)
    },
    resume: () => {
      synthesis.paused = false
      utterance?.onresume?.(new Event('resume') as SpeechSynthesisEvent)
    },
    speak: (next) => {
      utterance = next as FakeUtterance
      synthesis.speaking = true
      utterance.onstart?.(new Event('start') as SpeechSynthesisEvent)
    },
    addEventListener: (_type, listener) => { voicesChanged = listener },
    removeEventListener: () => { voicesChanged = undefined },
  }

  const environment: SpeechEnvironment = {
    synthesis,
    createUtterance: (text) => ({ text, rate: 1, pitch: 1, volume: 1 } as FakeUtterance),
  }
  return {
    environment,
    synthesis,
    get utterance() { return utterance },
    get cancelled() { return cancelled },
    triggerVoicesChanged: () => voicesChanged?.(),
  }
}

describe('原生语音文本处理', () => {
  it('按中英文句末标点切句并保留原文本位置', () => {
    const sentences = splitSpeechSentences('  第一句。\n第二句！最后一段')
    expect(sentences.map((sentence) => sentence.text)).toEqual(['第一句。', '第二句！', '最后一段'])
    expect(sentences[0]).toMatchObject({ start: 2, end: 6 })
    expect(sentences[1].start).toBe(7)
  })

  it('普通话音色排在其他声音前，且用户选中优先', () => {
    const voices = [voice('English', 'en-US', 'en', true), voice('普通话', 'zh-CN', 'zh-cn'), voice('普通话增强', 'zh-Hans-CN', 'zh-hans'), voice('中文台湾', 'zh-TW', 'zh-tw')]
    expect(listSpeechVoices(voices).map((item) => item.name)).toEqual(['普通话', '普通话增强', '中文台湾', 'English'])
    expect(resolveSpeechVoice(voices)?.voiceURI).toBe('zh-cn')
    expect(resolveSpeechVoice(voices, 'en')?.voiceURI).toBe('en')
    expect(resolveSpeechVoice(voices, 'old-uri', 'English')?.voiceURI).toBe('en')
  })

  it('将系统错误转换为可恢复的中文提示', () => {
    expect(speechErrorMessage('not-allowed')).toContain('允许媒体播放')
    expect(speechErrorMessage('voice-unavailable')).toContain('选择其他音色')
  })
})

describe('讲题朗读开关偏好', () => {
  it('缺少旧版设置时默认启用，用户关闭后可持久化为 false', () => {
    const defaults = (saved?: Partial<SpeechPreferences>): SpeechPreferences => ({ enabled: saved?.enabled !== false, rate: saved?.rate ?? 1 })
    expect(defaults()).toEqual({ enabled: true, rate: 1 })
    expect(defaults({ enabled: false })).toEqual({ enabled: false, rate: 1 })
  })

  it('总开关关闭后，序列化恢复仍保持关闭状态', () => {
    const state = reducer(emptyState(), {
      type: 'SET_SETTINGS',
      patch: { speech: { enabled: false, rate: 1.25, preferredLang: 'zh-CN' } },
    })
    const restored = normalizeState(JSON.parse(JSON.stringify(state)))

    expect(restored.settings.speech).toMatchObject({ enabled: false, rate: 1.25, preferredLang: 'zh-CN' })
  })
})

describe('BrowserSpeechController', () => {
  it('朗读、句子高亮、暂停、继续和停止状态正确', () => {
    const fake = makeEnvironment()
    const states: string[] = []
    const highlighted: string[] = []
    const controller = new BrowserSpeechController({
      onStateChange: (state) => states.push(state),
      onSentenceChange: (sentence) => { if (sentence) highlighted.push(sentence.text) },
    }, fake.environment)

    expect(controller.speak('第一句。第二句！', { rate: 1.25, voiceId: 'zh-cn' })).toBe(true)
    expect(fake.utterance?.rate).toBe(1.25)
    expect(fake.utterance?.voice?.voiceURI).toBe('zh-cn')
    expect(highlighted).toEqual(['第一句。'])

    fake.utterance?.onboundary?.({ charIndex: 4 } as SpeechSynthesisEvent)
    expect(highlighted[highlighted.length - 1]).toBe('第二句！')

    expect(controller.pause()).toBe(true)
    expect(states[states.length - 1]).toBe('paused')
    expect(controller.resume()).toBe(true)
    expect(states[states.length - 1]).toBe('speaking')
    controller.stop()
    expect(states[states.length - 1]).toBe('idle')
    expect(fake.cancelled).toBeGreaterThan(0)
  })

  it('声音列表变更会刷新，卸载后移除监听并停止朗读', () => {
    const fake = makeEnvironment()
    const updates: number[] = []
    const controller = new BrowserSpeechController({ onVoicesChange: (voices) => updates.push(voices.length) }, fake.environment)
    fake.triggerVoicesChanged()
    expect(updates).toEqual([3])
    controller.speak('测试')
    controller.dispose()
    expect(fake.cancelled).toBeGreaterThan(0)
    fake.triggerVoicesChanged()
    expect(updates).toEqual([3])
  })

  it('设备不支持时不尝试朗读，并提示使用文字讲解', () => {
    const errors: string[] = []
    const controller = new BrowserSpeechController({ onError: (message) => errors.push(message) }, {})
    expect(controller.speak('测试')).toBe(false)
    expect(errors).toEqual([SPEECH_UNSUPPORTED_MESSAGE])
  })
})

import { describe, expect, it } from 'vitest'
import {
  BrowserSpeechController,
  browserSpeechEnvironment,
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
  let resumed = 0

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
      resumed++
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
    get resumed() { return resumed },
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

  it('系统提供自然音色时优先使用，不再默认选择机械 SAPI 音色', () => {
    const voices = [
      voice('Microsoft Huihui Desktop', 'zh-CN', 'huihui'),
      voice('Microsoft Xiaoxiao Online (Natural)', 'zh-CN', 'xiaoxiao'),
    ]
    expect(listSpeechVoices(voices)[0]).toMatchObject({ name: 'Microsoft Xiaoxiao Online (Natural)', isNatural: true })
    expect(resolveSpeechVoice(voices)?.voiceURI).toBe('xiaoxiao')
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
    expect(fake.resumed).toBeGreaterThan(0)
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

  it('初始探测失败后，语音 API 延迟注入时可通过 probeSupport 恢复朗读', () => {
    const errors: string[] = []
    const controller = new BrowserSpeechController({ onError: (message) => errors.push(message) }, {})
    expect(controller.supported).toBe(false)
    expect(controller.probeSupport()).toBe(false)

    const fake = makeEnvironment()
    expect(controller.probeSupport(fake.environment)).toBe(true)
    expect(controller.speak('测试', { voiceId: 'zh-cn' })).toBe(true)
    expect(fake.utterance?.voice?.voiceURI).toBe('zh-cn')
  })

  it('已支持的控制器重复 probeSupport 保持可用，卸载后探测失败', () => {
    const fake = makeEnvironment()
    const controller = new BrowserSpeechController({}, fake.environment)
    expect(controller.probeSupport()).toBe(true)
    controller.dispose()
    expect(controller.probeSupport(fake.environment)).toBe(false)
  })
})

describe('Android 原生 TTS 桥适配', () => {
  function makeBridge() {
    const calls: Array<{ id: string; text: string; rate: number; voiceName: string }> = []
    let stopped = 0
    const bridge = {
      info: () => '{"ready":true}',
      voices: () =>
        JSON.stringify([
          { voiceURI: 'vivo-en', name: 'vivo English', lang: 'en-US', default: false, localService: true },
          { voiceURI: 'vivo-local-cmn', name: 'vivo 普通话', lang: 'zh-CN', default: false, localService: true },
        ]),
      speak: (id: string, text: string, rate: number, voiceName: string) => {
        calls.push({ id, text, rate, voiceName })
        return true
      },
      stop: () => {
        stopped += 1
      },
    }
    return { bridge, calls, stoppedCount: () => stopped }
  }

  function fireNative(type: string, id: string, extra = '0') {
    ;(globalThis as unknown as Record<string, unknown>).__zsbTtsEvent?.(type, id, extra)
  }

  it('桥存在时语音走原生系统 TTS：选声、播放、暂停续播全链路', () => {
    const env = makeBridge()
    ;(globalThis as unknown as Record<string, unknown>).ZsbNativeTts = env.bridge
    try {
      const states: string[] = []
      const highlighted: string[] = []
      const controller = new BrowserSpeechController({
        onStateChange: (state) => states.push(state),
        onSentenceChange: (sentence) => { if (sentence) highlighted.push(sentence.text) },
      }, browserSpeechEnvironment())

      expect(controller.supported).toBe(true)
      const voiceNames = controller.voices().map((voice) => voice.name)
      expect(voiceNames.some((name) => name.includes('悦悦·标准'))).toBe(true)
      expect(voiceNames.some((name) => name.includes('甜甜·清亮'))).toBe(true)

      expect(controller.speak('第一句。第二句！', { rate: 1.25, voiceId: 'vivo-local-cmn' })).toBe(true)
      expect(env.calls[0]).toMatchObject({ text: '第一句。第二句！', rate: 1.25, voiceName: 'vivo-local-cmn' })

      const id = env.calls[0].id
      fireNative('start', id)
      expect(states[states.length - 1]).toBe('speaking')
      expect(highlighted[0]).toBe('第一句。')

      fireNative('boundary', id, '4')
      expect(highlighted[highlighted.length - 1]).toBe('第二句！')

      expect(controller.pause()).toBe(true)
      expect(states[states.length - 1]).toBe('paused')
      expect(controller.resume()).toBe(true)
      expect(env.calls[1]).toMatchObject({ text: '第二句！', rate: 1.25 })
      expect(states[states.length - 1]).toBe('speaking')

      fireNative('end', env.calls[1].id)
      expect(states[states.length - 1]).toBe('idle')

      controller.stop()
      expect(env.stoppedCount()).toBeGreaterThan(0)
      // 停止后到达的旧事件不应再影响状态
      fireNative('boundary', id, '8')
      expect(states[states.length - 1]).toBe('idle')
    } finally {
      delete (globalThis as unknown as Record<string, unknown>).ZsbNativeTts
    }
  })

  it('原生 speak 提交成功即进入 speaking（乐观状态），start 事件幂等', () => {
    const states: string[] = []
    const env = makeBridge()
    ;(globalThis as unknown as Record<string, unknown>).ZsbNativeTts = env.bridge
    try {
      const controller = new BrowserSpeechController({ onStateChange: (state) => states.push(state) }, browserSpeechEnvironment())
      controller.speak('你好。')
      const id = env.calls[0].id
      // stop() 的收尾 idle 属正常清理;关键是 speak 提交后立即 speaking,不再依赖原生 onStart 回调。
      expect(states[states.length - 1]).toBe('speaking')
      fireNative('start', id)
      expect(states.filter((state) => state === 'speaking')).toHaveLength(1)
      // 软件派生音色:pitch URI 原样传给原生端解析
      controller.speak('低音测试。', { voiceId: 'zsb-pitch:0.72' })
      expect(env.calls[1]).toMatchObject({ voiceName: 'zsb-pitch:0.72' })
    } finally {
      delete (globalThis as unknown as Record<string, unknown>).ZsbNativeTts
    }
  })

  it('原生 speak 提交失败时上报错误而不是无声', async () => {
    const errors: string[] = []
    const bridge = {
      info: () => '{"ready":false}',
      voices: () => '[]',
      speak: () => false,
      stop: () => {},
    }
    ;(globalThis as unknown as Record<string, unknown>).ZsbNativeTts = bridge
    try {
      const controller = new BrowserSpeechController({ onError: (message) => errors.push(message) }, browserSpeechEnvironment())
      expect(controller.speak('测试')).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(errors.length).toBe(1)
    } finally {
      delete (globalThis as unknown as Record<string, unknown>).ZsbNativeTts
    }
  })
})

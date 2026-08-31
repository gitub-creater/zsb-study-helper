import { describe, expect, it } from 'vitest'
import { sseDataDelta, AiAbortedError } from '../src/services/ai'
import {
  buildRequestMessages,
  extractFinalAnswer,
  validateImageFile,
} from '../src/lib/mathai'
import { MATH_SKILL } from '../src/skills/math'
import { DEFAULT_SKILL_ID, SKILLS, getSkill } from '../src/skills'

describe('SSE 增量解析', () => {
  it('解析 data 行中的增量文本', () => {
    expect(sseDataDelta('data: {"choices":[{"delta":{"content":"x^2"}}]}')).toBe('x^2')
    expect(sseDataDelta('data:{"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好')
  })

  it('data 行无内容时返回空串(角色帧)', () => {
    expect(sseDataDelta('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBe('')
  })

  it('非数据行 / [DONE] / 坏 JSON 返回 null', () => {
    expect(sseDataDelta(': keep-alive')).toBeNull()
    expect(sseDataDelta('event: ping')).toBeNull()
    expect(sseDataDelta('data: [DONE]')).toBeNull()
    expect(sseDataDelta('data: {bad json}')).toBeNull()
    expect(sseDataDelta('')).toBeNull()
  })
})

describe('最终答案提取', () => {
  const sample = [
    '## 题目识别',
    '求 lim(x→0) sin3x/tan5x。',
    '## 详细步骤',
    '第一步…',
    '## 最终答案',
    '**极限值为 $\\dfrac{3}{5}$**',
  ].join('\n')

  it('提取「最终答案」小节内容', () => {
    const out = extractFinalAnswer(sample)
    expect(out).toBe('**极限值为 $\\dfrac{3}{5}$**')
  })

  it('最终答案后若还有其他小节则截断', () => {
    const out = extractFinalAnswer(sample + '\n## 易错点\n注意 John 极限。')
    expect(out).not.toContain('易错点')
    expect(out).toContain('dfrac')
  })

  it('没有小节标题时回退为全文', () => {
    expect(extractFinalAnswer('答案是 42')).toBe('答案是 42')
  })

  it('支持加粗标题写法', () => {
    expect(extractFinalAnswer('过程略\n**最终答案**\nx = 1')).toBe('x = 1')
  })
})

describe('请求上下文窗口', () => {
  const sys = '系统提示词'

  it('系统提示词在最前,历史按窗口截断', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `消息${i}`,
    }))
    const msgs = buildRequestMessages(sys, history)
    expect(msgs[0]).toEqual({ role: 'system', content: sys })
    expect(msgs).toHaveLength(17)
    expect(msgs[1].content).toContain('消息4')
    expect(msgs[16].content).toContain('消息19')
  })

  it('图片只保留在最近的用户消息,更早的降级为文字占位', () => {
    const history = [
      { role: 'user' as const, text: '第一题', images: ['data:image/png;base64,AAA'] },
      { role: 'assistant' as const, text: '第一题解答' },
      { role: 'user' as const, text: '第二题', images: ['data:image/png;base64,BBB'] },
    ]
    const msgs = buildRequestMessages(sys, history, { maxMessages: 10, imageWindow: 1 })
    const first = msgs[1]
    expect(typeof first.content).toBe('string')
    expect(first.content).toContain('图片已省略')
    const last = msgs[3]
    expect(Array.isArray(last.content)).toBe(true)
    const parts = last.content as { type: string }[]
    expect(parts.some((p) => p.type === 'image_url')).toBe(true)
  })

  it('纯文本消息保持字符串内容', () => {
    const msgs = buildRequestMessages(sys, [{ role: 'user', text: '求导 y=x^2' }])
    expect(msgs[1].content).toBe('求导 y=x^2')
  })
})

describe('图片校验', () => {
  const mk = (type: string, size: number) => new File([new ArrayBuffer(size)], 't', { type })

  it('PNG/JPG/WEBP 通过', () => {
    expect(validateImageFile(mk('image/png', 1024))).toBeNull()
    expect(validateImageFile(mk('image/jpeg', 1024))).toBeNull()
    expect(validateImageFile(mk('image/webp', 1024))).toBeNull()
  })

  it('拒绝其他格式', () => {
    expect(validateImageFile(mk('image/gif', 1024))).toContain('不支持')
    expect(validateImageFile(mk('application/pdf', 1024))).toContain('不支持')
  })

  it('拒绝超大文件', () => {
    expect(validateImageFile(mk('image/png', 9 * 1024 * 1024))).toContain('太大')
  })
})

describe('数学题技能模块', () => {
  it('注册表包含数学技能且默认可用', () => {
    expect(SKILLS.length).toBeGreaterThan(0)
    expect(DEFAULT_SKILL_ID).toBe('math')
    expect(getSkill('math').id).toBe('math')
    expect(getSkill('not-exist').id).toBe('math')
  })

  it('系统提示词包含输出格式与验证要求', () => {
    const p = MATH_SKILL.buildSystemPrompt({ reasoningLevel: 'high' })
    expect(p).toContain('题目识别')
    expect(p).toContain('最终答案')
    expect(p).toContain('易错点')
    expect(p).toContain('验证')
    expect(p).toContain('LaTeX')
    expect(p).toContain('编造')
    expect(p).toContain('完整工作流')
  })

  it('思考程度影响提示词', () => {
    const low = MATH_SKILL.buildSystemPrompt({ reasoningLevel: 'low' })
    const high = MATH_SKILL.buildSystemPrompt({ reasoningLevel: 'high' })
    expect(low).toContain('精炼')
    expect(high).toContain('完整')
    expect(low).not.toBe(high)
  })

  it('空输入被 guard 拦截,带图或带文字放行', () => {
    expect(MATH_SKILL.guard?.('', 0)).toBeTruthy()
    expect(MATH_SKILL.guard?.('求极限', 0)).toBeNull()
    expect(MATH_SKILL.guard?.('', 2)).toBeNull()
  })

  it('提供快捷追问', () => {
    expect(MATH_SKILL.quickActions.length).toBeGreaterThanOrEqual(3)
    expect(MATH_SKILL.quickActions.some((q) => q.prompt.includes('换一种方法'))).toBe(true)
  })
})

describe('AiAbortedError', () => {
  it('停止生成错误可识别', () => {
    const e = new AiAbortedError()
    expect(e instanceof AiAbortedError).toBe(true)
    expect(e.message).toContain('停止')
  })
})

import { describe, expect, it } from 'vitest'
import { checkOpAnswer, totalOpPoints } from '../src/lib/office'
import type { OpQuestion } from '../src/lib/office'

function q(partial: Partial<OpQuestion>): OpQuestion {
  return {
    id: 'q', office: 'word', type: 'single', stem: 's', options: [], answer: 'B',
    points: 2, analysis: '', steps: [], keyPoint: '', commonError: '', source: 'test', year: 2026, difficulty: 1,
    ...partial,
  }
}

describe('笔试操作题判定', () => {
  it('单选:精确匹配(不区分大小写)', () => {
    expect(checkOpAnswer(q({ answer: 'B' }), 'B')).toBe(true)
    expect(checkOpAnswer(q({ answer: 'B' }), 'b')).toBe(true)
    expect(checkOpAnswer(q({ answer: 'B' }), 'A')).toBe(false)
    expect(checkOpAnswer(q({ answer: 'B' }), '')).toBe(false)
  })

  it('多选:按字母集合比较,顺序无关', () => {
    const m = q({ type: 'multiple', answer: 'ABC' })
    expect(checkOpAnswer(m, 'CBA')).toBe(true)
    expect(checkOpAnswer(m, 'AB')).toBe(false)
    expect(checkOpAnswer(m, 'ABCD')).toBe(false)
    expect(checkOpAnswer(m, '')).toBe(false)
  })

  it('填空:忽略大小写/空格/等号,支持多个备选答案', () => {
    const f = q({ type: 'fill', answer: '=AVERAGE(B2:B10)|AVERAGE(B2:B10)' })
    expect(checkOpAnswer(f, '=AVERAGE(B2:B10)')).toBe(true)
    expect(checkOpAnswer(f, 'average(b2:b10)')).toBe(true)
    expect(checkOpAnswer(f, '= AVERAGE (B2 : B10)')).toBe(true)
    expect(checkOpAnswer(f, '=SUM(B2:B10)')).toBe(false)
    expect(checkOpAnswer(f, '')).toBe(false)
  })

  it('中文填空答案同样可判定', () => {
    const f = q({ type: 'fill', answer: '居中|居中对齐' })
    expect(checkOpAnswer(f, '居中')).toBe(true)
    expect(checkOpAnswer(f, '居中对齐')).toBe(true)
    expect(checkOpAnswer(f, ' 左对齐 ')).toBe(false)
  })

  it('分值合计', () => {
    const list = [q({ points: 2 }), q({ points: 2 }), q({ points: 4 })]
    expect(totalOpPoints(list)).toBe(8)
  })
})

import { describe, expect, it } from 'vitest'
import { checkAnswer } from '../src/lib/misc'
import { parseCsv, toCsv } from '../src/lib/csv'
import { levelInfo } from '../src/lib/xp'

describe('答案判定', () => {
  it('单选精确匹配', () => {
    expect(checkAnswer({ type: 'single', answer: 'B' }, 'B')).toBe(true)
    expect(checkAnswer({ type: 'single', answer: 'B' }, 'A')).toBe(false)
    expect(checkAnswer({ type: 'single', answer: 'B' }, '')).toBe(false)
  })

  it('多选按字母集合比较(顺序无关)', () => {
    expect(checkAnswer({ type: 'multiple', answer: 'ABD' }, 'DBA')).toBe(true)
    expect(checkAnswer({ type: 'multiple', answer: 'ABD' }, 'AB')).toBe(false)
    expect(checkAnswer({ type: 'multiple', answer: 'ABD' }, 'ABCD')).toBe(false)
  })

  it('填空归一化比较(忽略大小写/空白/标点)', () => {
    expect(checkAnswer({ type: 'fill', answer: '导 数' }, '导数')).toBe(true)
    expect(checkAnswer({ type: 'fill', answer: 'e' }, 'E。')).toBe(true)
    expect(checkAnswer({ type: 'fill', answer: '极限' }, '导数')).toBe(false)
  })

  it('判断按选项字母', () => {
    expect(checkAnswer({ type: 'judge', answer: 'A' }, 'A')).toBe(true)
  })
})

describe('CSV 解析与生成', () => {
  it('解析带引号与逗号的字段', () => {
    const rows = parseCsv('a,b\n"含,逗号","含""引号"""')
    expect(rows).toEqual([
      ['a', 'b'],
      ['含,逗号', '含"引号"'],
    ])
  })

  it('忽略空行与 BOM', () => {
    const rows = parseCsv('\uFEFFh1,h2\n\nv1,v2\n')
    expect(rows).toEqual([['h1', 'h2'], ['v1', 'v2']])
  })

  it('生成后再解析保持一致', () => {
    const csv = toCsv(['题干', '选项A'], [['含,逗号', 'A'], ['正常', 'B']])
    const rows = parseCsv(csv)
    expect(rows).toEqual([
      ['题干', '选项A'],
      ['含,逗号', 'A'],
      ['正常', 'B'],
    ])
  })
})

describe('经验与等级', () => {
  it('等级阈值与进度', () => {
    expect(levelInfo(0).level).toBe(1)
    expect(levelInfo(100).level).toBe(2)
    expect(levelInfo(299).level).toBe(2)
    expect(levelInfo(300).level).toBe(3)
    const l = levelInfo(150)
    expect(l.progress).toBeGreaterThan(0)
    expect(l.progress).toBeLessThan(1)
  })
})

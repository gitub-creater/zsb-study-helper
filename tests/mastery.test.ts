import { describe, expect, it } from 'vitest'
import { computeKpMastery, nextStatus } from '../src/lib/mastery'
import type { Attempt, KPStats } from '../src/types'

function stats(partial: Partial<KPStats>): KPStats {
  return { attempts: 0, correct: 0, wrongCount: 0, lastPracticedAt: null, streak: 0, reviewBonus: 0, ...partial }
}

function attempts(pattern: boolean[]): Attempt[] {
  return pattern.map((correct, i) => ({
    id: `a${i}`, questionId: 'q', kpId: 'k', subjectId: 's', correct,
    userAnswer: '', mode: 'kp', at: new Date(Date.now() - i * 3600_000).toISOString(), date: '2026-08-28',
  }))
}

describe('掌握度计算', () => {
  it('练习不足 3 次返回 null(数据不足)', () => {
    expect(computeKpMastery({ stats: stats({ attempts: 2 }) }, attempts([true, true]))).toBeNull()
  })

  it('全对且练习充分得到高分', () => {
    const m = computeKpMastery(
      { stats: stats({ attempts: 6, correct: 6, streak: 4 }) },
      attempts([true, true, true, true, true, true])
    )
    expect(m).toBeGreaterThanOrEqual(80)
  })

  it('错误率高时掌握度低', () => {
    const m = computeKpMastery(
      { stats: stats({ attempts: 6, correct: 2, wrongCount: 4 }) },
      attempts([false, true, false, false, true, false])
    )
    expect(m).toBeLessThan(40)
  })

  it('长期未练习会衰减', () => {
    const recent = computeKpMastery(
      { stats: stats({ attempts: 4, correct: 4, lastPracticedAt: new Date().toISOString() }) },
      attempts([true, true, true, true])
    )
    const old = computeKpMastery(
      { stats: stats({ attempts: 4, correct: 4, lastPracticedAt: new Date(Date.now() - 40 * 86400000).toISOString() }) },
      attempts([true, true, true, true])
    )
    expect(old).toBeLessThan(recent!)
  })
})

describe('知识点状态迁移', () => {
  it('答错把已掌握打回待复习', () => {
    expect(nextStatus('mastered', false, 90, 6)).toBe('toReview')
    expect(nextStatus('basic', false, 70, 6)).toBe('toReview')
  })

  it('掌握需要掌握度与练习次数同时达标', () => {
    expect(nextStatus('learning', true, 90, 3)).toBe('basic') // 次数不足
    expect(nextStatus('learning', true, 90, 5)).toBe('mastered')
    expect(nextStatus('learning', true, 70, 8)).toBe('basic')
  })

  it('首次答错/答对进入学习中', () => {
    expect(nextStatus('unlearned', false, null, 1)).toBe('learning')
    expect(nextStatus('unlearned', true, null, 1)).toBe('learning')
  })
})

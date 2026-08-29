import { describe, expect, it } from 'vitest'
import { entryOnCorrectReview, entryOnEarlyCorrect, entryOnWrong, dueEntries } from '../src/lib/spaced'
import type { Question, WrongEntry } from '../src/types'
import { emptyStats } from '../src/store/store'

const INTERVALS = [1, 3, 7, 14, 30]
const DATE = '2026-08-28'

const q: Question = {
  id: 'q1', subjectId: 's1', chapterId: 'c1', kpId: 'k1', type: 'single',
  stem: 't', options: ['a', 'b'], answer: 'A', explanation: 'e',
  difficulty: 1, source: 'test', year: 2025, official: false, createdAt: '',
}

function entry(partial: Partial<WrongEntry>): WrongEntry {
  return {
    questionId: 'q1', kpId: 'k1', subjectId: 's1', wrongCount: 1,
    firstWrongAt: DATE, lastWrongAt: DATE, lastUserAnswer: 'B', correctAnswer: 'A',
    reason: null, intervalIndex: 0, streakCorrect: 0, reviewLog: [],
    nextReviewAt: '2026-08-29', archived: false, ...partial,
  }
}

describe('间隔复习', () => {
  it('新答错进入错题本,间隔为第一档', () => {
    const e = entryOnWrong(undefined, q, INTERVALS, DATE, DATE, 'B')
    expect(e.wrongCount).toBe(1)
    expect(e.intervalIndex).toBe(0)
    expect(e.nextReviewAt).toBe('2026-08-29')
    expect(e.archived).toBe(false)
  })

  it('再次答错重置为第一档', () => {
    const e = entryOnWrong(entry({ intervalIndex: 3, wrongCount: 2 }), q, INTERVALS, DATE, DATE, 'C')
    expect(e.intervalIndex).toBe(0)
    expect(e.wrongCount).toBe(3)
    expect(e.nextReviewAt).toBe('2026-08-29')
  })

  it('到期复习答对推进一档', () => {
    const e = entryOnCorrectReview(entry({ intervalIndex: 1, streakCorrect: 0 }), INTERVALS, DATE)
    expect(e.intervalIndex).toBe(2)
    expect(e.nextReviewAt).toBe('2026-09-04') // +7 天
    expect(e.reviewLog).toHaveLength(1)
  })

  it('偶然答对一次不会归档(最高档需连续两次答对)', () => {
    const once = entryOnCorrectReview(entry({ intervalIndex: 4, streakCorrect: 0 }), INTERVALS, DATE)
    expect(once.archived).toBe(false)
    const twice = entryOnCorrectReview(once, INTERVALS, DATE)
    expect(twice.archived).toBe(true)
    expect(twice.nextReviewAt).toBeNull()
  })

  it('未到期答对只记录,不推进间隔', () => {
    const e = entryOnEarlyCorrect(entry({ intervalIndex: 1, nextReviewAt: '2026-09-01' }), DATE)
    expect(e.intervalIndex).toBe(1)
    expect(e.nextReviewAt).toBe('2026-09-01')
    expect(e.reviewLog).toHaveLength(1)
  })

  it('dueEntries 只返回到期且未归档的条目', () => {
    const wrong = {
      a: entry({ questionId: 'a', nextReviewAt: '2026-08-27' }),
      b: entry({ questionId: 'b', nextReviewAt: '2026-08-29' }),
      c: entry({ questionId: 'c', nextReviewAt: null, archived: true }),
    }
    const due = dueEntries(wrong, DATE)
    expect(due.map((e) => e.questionId)).toEqual(['a'])
  })
})

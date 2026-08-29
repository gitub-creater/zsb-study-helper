// 错题间隔复习:默认 1 → 3 → 7 → 14 → 30 天,可在设置中调整
import type { Question, WrongEntry } from '../types'
import { addDays } from './date'

export function intervalStageText(intervals: number[]): string {
  return intervals.join(' → ') + ' 天'
}

export function dueEntries(wrong: Record<string, WrongEntry>, date: string): WrongEntry[] {
  return Object.values(wrong)
    .filter((e) => !e.archived && e.nextReviewAt != null && e.nextReviewAt <= date)
    .sort((a, b) => (a.nextReviewAt ?? '') < (b.nextReviewAt ?? '') ? -1 : 1)
}

export function totalReviewCount(wrong: Record<string, WrongEntry>): number {
  return Object.values(wrong).reduce((s, e) => s + e.reviewLog.length, 0)
}

/** 新答错:进入错题本,间隔重置为第一档 */
export function entryOnWrong(
  prev: WrongEntry | undefined,
  q: Question,
  intervals: number[],
  date: string,
  nowIso: string,
  userAnswer: string
): WrongEntry {
  const base: WrongEntry = prev ?? {
    questionId: q.id,
    kpId: q.kpId,
    subjectId: q.subjectId,
    wrongCount: 0,
    firstWrongAt: nowIso,
    lastWrongAt: nowIso,
    lastUserAnswer: userAnswer,
    correctAnswer: q.answer,
    reason: null,
    intervalIndex: 0,
    streakCorrect: 0,
    reviewLog: [],
    nextReviewAt: null,
    archived: false,
  }
  return {
    ...base,
    wrongCount: base.wrongCount + 1,
    lastWrongAt: nowIso,
    lastUserAnswer: userAnswer,
    correctAnswer: q.answer,
    intervalIndex: 0,
    streakCorrect: 0,
    nextReviewAt: addDays(date, intervals[0]),
    archived: false,
  }
}

/** 到期复习答对:推进一档;在最高档连续答对 2 次才归档(偶然答对一次不算掌握) */
export function entryOnCorrectReview(
  entry: WrongEntry,
  intervals: number[],
  date: string
): WrongEntry {
  const streakCorrect = entry.streakCorrect + 1
  const maxIdx = intervals.length - 1
  if (entry.intervalIndex >= maxIdx && streakCorrect >= 2) {
    return {
      ...entry,
      streakCorrect,
      nextReviewAt: null,
      archived: true,
      reviewLog: [...entry.reviewLog, { date, correct: true }],
    }
  }
  const nextIdx = Math.min(entry.intervalIndex + 1, maxIdx)
  return {
    ...entry,
    streakCorrect,
    intervalIndex: nextIdx,
    nextReviewAt: addDays(date, intervals[nextIdx]),
    reviewLog: [...entry.reviewLog, { date, correct: true }],
  }
}

/** 未到期但答对:记录结果,不推进间隔 */
export function entryOnEarlyCorrect(entry: WrongEntry, date: string): WrongEntry {
  return { ...entry, reviewLog: [...entry.reviewLog, { date, correct: true }] }
}

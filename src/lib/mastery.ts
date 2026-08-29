// 掌握度模型:0-100,null 表示数据不足(不产生虚假精确结论)
import type { Attempt, KPStatus, KnowledgePoint } from '../types'
import { avg, clamp } from './misc'

const DIFF_WEIGHT: Record<number, number> = { 1: 1, 2: 1.2, 3: 1.5 }

export function difficultyWeight(d: number): number {
  return DIFF_WEIGHT[d] ?? 1
}

/**
 * 综合掌握度:
 * 最近10次正确率 45% + 历史正确率 25% + 难度加权正确率 20%
 * + 错题复习成果(≤10) + 连续答对(≤6) - 遗忘衰减 - 错误次数惩罚
 * 练习次数 < 3 时返回 null(数据不足)
 */
export function computeKpMastery(
  kp: Pick<KnowledgePoint, 'stats'>,
  attempts: Attempt[],
  weightOf?: (a: Attempt) => number
): number | null {
  const n = attempts.length
  if (n < 3) return null
  const recent = attempts.slice(-10)
  const recentAcc = avg(recent.map((a) => (a.correct ? 1 : 0)))
  const totalAcc = avg(attempts.map((a) => (a.correct ? 1 : 0)))
  let wSum = 0
  let wOk = 0
  for (const a of attempts) {
    const w = weightOf ? weightOf(a) : 1
    wSum += w
    if (a.correct) wOk += w
  }
  const wAcc = wSum > 0 ? wOk / wSum : 0

  let m = recentAcc * 45 + totalAcc * 25 + wAcc * 20
  m += Math.min(kp.stats.reviewBonus, 10)
  m += Math.min(kp.stats.streak * 2, 6)

  if (kp.stats.lastPracticedAt) {
    const days = Math.floor((Date.now() - new Date(kp.stats.lastPracticedAt).getTime()) / 86400000)
    if (days > 30) m -= 20
    else if (days > 14) m -= 10
  }
  m -= Math.min(kp.stats.wrongCount, 10)
  return clamp(Math.round(m), 0, 100)
}

/** 答题后的知识点状态迁移 */
export function nextStatus(current: KPStatus, correct: boolean, m: number | null, attempts: number): KPStatus {
  if (!correct) {
    if (current === 'mastered' || current === 'basic') return 'toReview'
    if (current === 'unlearned') return 'learning'
    return current
  }
  if (m != null) {
    if (m >= 80 && attempts >= 5) return 'mastered'
    if (m >= 60) return 'basic'
  }
  if (current === 'unlearned') return 'learning'
  return current
}

export function masteryTone(m: number | null): 'gray' | 'red' | 'yellow' | 'green' {
  if (m == null) return 'gray'
  if (m >= 80) return 'green'
  if (m >= 60) return 'yellow'
  return 'red'
}

// 经验与等级:只奖励真实学习行为,每日答题经验设上限防刷
import type { TaskType, XpLogEntry } from '../types'
import { clamp } from './misc'

const TITLES = ['见习冒险者', '学习学徒', '校园学者', '知识骑士', '星标优等生', '学霸导师', '状元候补', '满分传说']

/** 达到 level 级所需累计经验 */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * level
}

export function levelInfo(xp: number): {
  level: number
  title: string
  curBase: number
  nextNeed: number
  progress: number
} {
  let level = 1
  while (level < 99 && xpForLevel(level + 1) <= xp) level++
  const curBase = xpForLevel(level)
  const nextNeed = xpForLevel(level + 1)
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)],
    curBase,
    nextNeed,
    progress: nextNeed > curBase ? clamp((xp - curBase) / (nextNeed - curBase), 0, 1) : 1,
  }
}

export const XP_RULES = {
  attemptCorrect: 4,
  attemptWrong: 1,
  reviewCorrect: 6,
  masterKp: 25,
  dailyAllDone: 20,
}

export const TASK_XP: Record<TaskType, number> = {
  learnKP: 12,
  chapterPractice: 15,
  reviewWrong: 10,
  memorize: 8,
  stageTest: 30,
  mockExam: 50,
}

export function pushXpLog(log: XpLogEntry[], amount: number, reason: string): XpLogEntry[] {
  if (amount <= 0) return log
  return [{ t: Date.now(), amount, reason }, ...log].slice(0, 100)
}

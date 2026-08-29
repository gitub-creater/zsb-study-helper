// 派生数据选择器:掌握度汇总、薄弱点、到期错题等
import type { Attempt, KnowledgePoint, Profile, State, Subject, Task, WrongEntry } from '../types'
import { avg } from './misc'
import { computeKpMastery, difficultyWeight } from './mastery'
import { parseDate, todayStr } from './date'

/** 科目是否在当前考试类别/公共课范围内(未选类别时全部可见;用于计划、薄弱点推荐等学习范围) */
export function subjectInScope(state: State, s: Subject): boolean {
  const cat = state.profile?.category
  const elective = state.profile?.elective ?? 'english'
  if (s.elective && s.elective !== elective) return false
  if (!cat) return true
  if (s.applicableCategories === undefined) return true
  return s.applicableCategories.includes(cat)
}

/** 知识校园(资料库)可见性:只按考试类别过滤,公共课两个科目都展示供查阅 */
export function subjectInLibrary(state: State, s: Subject): boolean {
  const cat = state.profile?.category
  if (!cat) return true
  if (s.applicableCategories === undefined) return true
  return s.applicableCategories.includes(cat)
}

export function kpInScope(state: State, kp: KnowledgePoint): boolean {
  const s = state.subjects.find((x) => x.id === kp.subjectId)
  return s ? subjectInScope(state, s) : false
}

export function kpAttempts(state: State, kpId: string): Attempt[] {
  return state.attempts.filter((a) => a.kpId === kpId)
}

/** 知识点掌握度:优先用缓存的最新值,否则现算 */
export function getMastery(state: State, kp: KnowledgePoint): number | null {
  if (kp.mastery != null) return kp.mastery
  return computeKpMastery(kp, kpAttempts(state, kp.id), (a) => {
    const q = state.questions.find((x) => x.id === a.questionId)
    return difficultyWeight(q?.difficulty ?? 1)
  })
}

export function chapterKps(state: State, chapterId: string): KnowledgePoint[] {
  return state.kps.filter((k) => k.chapterId === chapterId).sort((a, b) => a.order - b.order)
}

export function subjectKps(state: State, subjectId: string): KnowledgePoint[] {
  return state.kps.filter((k) => k.subjectId === subjectId)
}

function avgMastery(list: number[]): number | null {
  if (list.length === 0) return null
  return Math.round(avg(list))
}

export function chapterMastery(state: State, chapterId: string): number | null {
  const list = chapterKps(state, chapterId)
    .map((k) => getMastery(state, k))
    .filter((m): m is number => m != null)
  return avgMastery(list)
}

export function subjectMastery(state: State, subjectId: string): number | null {
  const list = subjectKps(state, subjectId)
    .map((k) => getMastery(state, k))
    .filter((m): m is number => m != null)
  return avgMastery(list)
}

export function subjectAccuracy(state: State, subjectId: string): number | null {
  const list = state.attempts.filter((a) => a.subjectId === subjectId)
  if (list.length === 0) return null
  return avg(list.map((a) => (a.correct ? 1 : 0)))
}

export function totalAccuracy(state: State): number | null {
  if (state.attempts.length === 0) return null
  return avg(state.attempts.map((a) => (a.correct ? 1 : 0)))
}

export function dueWrongList(state: State, date: string): WrongEntry[] {
  return Object.values(state.wrong)
    .filter((e) => !e.archived && e.nextReviewAt != null && e.nextReviewAt <= date)
    .sort((a, b) => ((a.nextReviewAt ?? '') < (b.nextReviewAt ?? '') ? -1 : 1))
}

/** 薄弱知识点排行:已练过且未掌握,按掌握度升序(仅限当前类别范围) */
export function weakKps(state: State, n = 10): KnowledgePoint[] {
  return state.kps
    .filter((k) => kpInScope(state, k) && k.stats.attempts > 0 && k.status !== 'mastered')
    .sort((a, b) => {
      const ma = getMastery(state, a) ?? 100
      const mb = getMastery(state, b) ?? 100
      if (ma !== mb) return ma - mb
      return b.stats.wrongCount - a.stats.wrongCount
    })
    .slice(0, n)
}

export function recentAccuracy(state: State, n = 20): number | null {
  const list = state.attempts.slice(-n)
  if (list.length === 0) return null
  return avg(list.map((a) => (a.correct ? 1 : 0)))
}

export function todayTasks(state: State): Task[] {
  return state.tasks[todayStr()] ?? []
}

/** 是否为排课学习日:weeklyDays=5 → 周一至周五,以此类推 */
export function isStudyDay(profile: Profile, date: string): boolean {
  const wd = parseDate(date).getDay()
  const order = [1, 2, 3, 4, 5, 6, 0] // 周一开始
  return order.slice(0, clampDays(profile.weeklyDays)).includes(wd)
}

function clampDays(n: number): number {
  return Math.max(0, Math.min(7, Math.round(n)))
}

export function masteredKpCount(state: State): number {
  return state.kps.filter((k) => k.status === 'mastered').length
}

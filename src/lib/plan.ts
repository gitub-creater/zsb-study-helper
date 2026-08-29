// 每日学习计划生成:依据考试日期、剩余知识点、每日可用时间、掌握度与到期错题
import type { KnowledgePoint, State, Task } from '../types'
import { TASK_XP } from './xp'
import { uid, clamp } from './misc'
import { daysBetween, todayStr } from './date'
import { dueWrongList, isStudyDay, recentAccuracy, subjectMastery, getMastery, kpInScope } from './selectors'

/** 挑选要学习的新知识点:当前类别范围内,薄弱科目优先、学习中优先、掌握度低优先 */
export function pickKpsForLearning(state: State, n: number): KnowledgePoint[] {
  const pool = state.kps.filter((k) => kpInScope(state, k) && k.status !== 'mastered')
  const smCache = new Map<string, number | null>()
  const score = (k: KnowledgePoint): number => {
    if (!smCache.has(k.subjectId)) smCache.set(k.subjectId, subjectMastery(state, k.subjectId))
    const sm = smCache.get(k.subjectId)
    const subjectScore = sm == null ? 0 : 100 - sm
    const statusScore = k.status === 'toReview' ? 20 : k.status === 'learning' ? 15 : 0
    const m = getMastery(state, k)
    const masteryScore = m == null ? 10 : (100 - m) * 0.3
    return subjectScore * 0.5 + statusScore + masteryScore
  }
  return [...pool].sort((a, b) => score(b) - score(a)).slice(0, n)
}

export function generateTasks(state: State, date: string): Task[] {
  const p = state.profile
  if (!p) return []
  const tasks: Task[] = []

  // 1. 到期错题复习永远优先(间隔复习不受"非学习日"影响)
  const due = dueWrongList(state, date)
  if (due.length > 0) {
    const count = Math.min(due.length, 20)
    tasks.push({
      id: uid('t'),
      type: 'reviewWrong',
      title: `复习到期的错题(共 ${due.length} 道到期)`,
      questionCount: count,
      progress: 0,
      done: false,
      estMinutes: Math.max(5, Math.round(count * 1.2)),
      xp: TASK_XP.reviewWrong,
    })
  }

  if (!isStudyDay(p, date)) {
    // 非学习日温和安排:只复习,不安排新课
    return tasks
  }

  // 2. 学习新知识点(按剩余时间与节奏计算)
  const remaining = state.kps.filter((k) => k.status !== 'mastered').length
  const daysLeft = Math.max(1, daysBetween(date, p.examDate))
  const studyDaysLeft = Math.max(1, Math.floor((daysLeft * p.weeklyDays) / 7))
  const pace = clamp(Math.ceil(remaining / studyDaysLeft), 1, 4)
  const timeCap = Math.max(1, Math.floor((p.dailyMinutes * 0.5) / 20))
  let nLearn = clamp(Math.min(pace, timeCap), 1, 4)
  const acc = recentAccuracy(state, 20)
  if (acc != null && acc < 0.6 && nLearn > 1) nLearn -= 1 // 最近正确率低时少学新课、多巩固

  const picked = pickKpsForLearning(state, nLearn)
  if (picked.length > 0) {
    const kpIds = picked.map((k) => k.id)
    tasks.push({
      id: uid('t'),
      type: 'learnKP',
      title: `学习新知识点:${picked.map((k) => k.name).join('、')}`,
      kpIds,
      questionCount: picked.length,
      progress: 0,
      done: false,
      estMinutes: picked.length * 20,
      xp: TASK_XP.learnKP + (picked.length - 1) * 6,
    })

    // 3. 巩固练习
    const qs = state.questions.filter((q) => kpIds.includes(q.kpId))
    if (qs.length > 0) {
      const count = Math.min(8, qs.length)
      tasks.push({
        id: uid('t'),
        type: 'chapterPractice',
        title: '章节练习:巩固今天所学',
        kpIds,
        questionCount: count,
        progress: 0,
        done: false,
        estMinutes: count,
        xp: TASK_XP.chapterPractice,
      })
    }
  }

  // 4. 每满 7 天安排一次阶段小测
  const since = daysBetween(p.createdAt.slice(0, 10), date)
  if (since > 0 && since % 7 === 0) {
    const pool = state.questions
    if (pool.length > 0) {
      const count = Math.min(10, pool.length)
      tasks.push({
        id: uid('t'),
        type: 'stageTest',
        title: '阶段小测:检验近期学习效果',
        questionCount: count,
        progress: 0,
        done: false,
        estMinutes: 15,
        xp: TASK_XP.stageTest,
      })
    }
  }

  return tasks
}

/** 重新生成:保留已完成任务,只重排未完成部分(不删除学习记录) */
export function regenerateTasks(state: State, date: string): Task[] {
  const old = state.tasks[date] ?? []
  const done = old.filter((t) => t.done)
  const identity = (t: Task): string => `${t.type}|${t.kpIds?.[0] ?? t.chapterId ?? ''}`
  const fresh = generateTasks(state, date).filter((t) => !done.some((d) => identity(d) === identity(t)))
  return [...done, ...fresh]
}

export function firstUndoneTask(tasks: Task[]): Task | undefined {
  return tasks.find((t) => !t.done)
}

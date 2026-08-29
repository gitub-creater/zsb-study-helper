// 练习会话构建:各种练习模式都汇聚成统一的 Session
import type { Question, Session, State, Task } from '../types'
import { PRACTICE_MODE_TEXT } from '../types'
import { shuffle } from './misc'
import { getMastery, dueWrongList } from './selectors'

export function makeSession(
  opts: {
    mode: Session['mode']
    name?: string
    questionIds: string[]
    taskId?: string
    limitSeconds?: number
  }
): Session {
  return {
    id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    mode: opts.mode,
    name: opts.name ?? PRACTICE_MODE_TEXT[opts.mode],
    questionIds: opts.questionIds,
    index: 0,
    answers: {},
    startedAt: new Date().toISOString(),
    taskId: opts.taskId,
    limitSeconds: opts.limitSeconds,
    expiresAt: opts.limitSeconds ? Date.now() + opts.limitSeconds * 1000 : undefined,
    xpGained: 0,
  }
}

function idsOf(qs: Question[]): string[] {
  return qs.map((q) => q.id)
}

/** 知识点专项练习 */
export function startKpPractice(state: State, kpId: string, count = 8): Session | null {
  const qs = shuffle(state.questions.filter((q) => q.kpId === kpId)).slice(0, count)
  if (qs.length === 0) return null
  return makeSession({ mode: 'kp', questionIds: idsOf(qs) })
}

/** 章节练习 */
export function startChapterPractice(state: State, chapterId: string, count = 10): Session | null {
  const qs = shuffle(state.questions.filter((q) => q.chapterId === chapterId)).slice(0, count)
  if (qs.length === 0) return null
  return makeSession({ mode: 'chapter', questionIds: idsOf(qs) })
}

/** 薄弱点强化:按所属知识点掌握度从低到高取题 */
export function startWeakPractice(state: State, count = 10, pool?: Question[]): Session | null {
  const source = pool ?? state.questions
  const ranked = [...source].sort((a, b) => {
    const ka = state.kps.find((k) => k.id === a.kpId)
    const kb = state.kps.find((k) => k.id === b.kpId)
    const ma = ka ? (getMastery(state, ka) ?? -1) : -1
    const mb = kb ? (getMastery(state, kb) ?? -1) : -1
    return ma - mb
  })
  const qs = ranked.slice(0, Math.max(1, count))
  if (qs.length === 0) return null
  return makeSession({ mode: 'weak', questionIds: idsOf(qs) })
}

/** 错题复习:默认取全部到期错题 */
export function startWrongReview(state: State, limit?: number): Session | null {
  const due = dueWrongList(state, new Date().toISOString().slice(0, 10))
  const ids = (limit ? due.slice(0, limit) : due).map((e) => e.questionId)
  if (ids.length === 0) return null
  return makeSession({ mode: 'wrong', name: '错题复习', questionIds: ids })
}

/** 限时测试:每题 45 秒 */
export function startTimedPractice(state: State, questions: Question[]): Session | null {
  if (questions.length === 0) return null
  return makeSession({
    mode: 'timed',
    questionIds: idsOf(questions),
    limitSeconds: questions.length * 45,
  })
}

/** 从每日任务启动练习 */
export function startPracticeFromTask(state: State, task: Task): Session | null {
  if (task.type === 'reviewWrong') {
    const due = dueWrongList(state, new Date().toISOString().slice(0, 10))
    const ids = due.slice(0, Math.max(1, task.questionCount)).map((e) => e.questionId)
    if (ids.length === 0) return null
    return makeSession({ mode: 'wrong', name: '错题复习', questionIds: ids, taskId: task.id })
  }
  if (task.type === 'chapterPractice') {
    const kpIds = task.kpIds ?? []
    let qs = state.questions.filter((q) => kpIds.includes(q.kpId))
    if (qs.length === 0) return null
    qs = shuffle(qs).slice(0, Math.max(1, task.questionCount))
    return makeSession({ mode: 'kp', name: '章节练习:巩固今天所学', questionIds: idsOf(qs), taskId: task.id })
  }
  if (task.type === 'stageTest') {
    const qs = shuffle(state.questions).slice(0, Math.max(1, task.questionCount))
    if (qs.length === 0) return null
    return makeSession({ mode: 'timed', name: '阶段小测', questionIds: idsOf(qs), taskId: task.id, limitSeconds: qs.length * 45 })
  }
  return null
}

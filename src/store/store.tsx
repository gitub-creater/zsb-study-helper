// 全局状态:reducer + localStorage 持久化 + 删除撤销
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type {
  Attempt, CatalogData, Chapter, KnowledgePoint, KPStats, OfficeResultRecord, PracticeMode, Profile, Question, SeedData,
  Session, SessionSummary, Settings, State, Subject, Task, WrongReason,
} from '../types'
import { XP_RULES, pushXpLog } from '../lib/xp'
import { CATALOG_VERSION } from '../lib/seed'
import { addDays, todayStr } from '../lib/date'
import { uid } from '../lib/misc'
import { computeKpMastery, difficultyWeight, nextStatus } from '../lib/mastery'
import { entryOnCorrectReview, entryOnEarlyCorrect, entryOnWrong } from '../lib/spaced'
import { generateTasks } from '../lib/plan'
import { getSession } from '../lib/auth'
import { downloadCloudState, uploadCloudState } from '../services/cloud'

const STORAGE_KEY = 'zsb_helper_v1'

export function emptyState(): State {
  return {
    version: 1,
    onboarded: false,
    profile: null,
    subjects: [],
    chapters: [],
    kps: [],
    questions: [],
    attempts: [],
    wrong: {},
    tasks: {},
    session: null,
    lastSummary: null,
    xp: 0,
    xpLog: [],
    practiceXpDate: '',
    practiceXpToday: 0,
    streak: { current: 0, best: 0, lastActive: null },
    studyTime: {},
    favorites: [],
    questionNotes: {},
    allDoneBonus: [],
    settings: { intervals: [1, 3, 7, 14, 30], dailyPracticeXpCap: 120, reduceMotion: false, mascotEnabled: true },
    seedLoaded: false,
    hiddenHot: [],
    officeResults: {},
    english: { checkedDates: [], mastered: [] },
    qaLog: [],
  }
}

export function emptyStats(): KPStats {
  return { attempts: 0, correct: 0, wrongCount: 0, lastPracticedAt: null, streak: 0, reviewBonus: 0 }
}

function load(storageKey: string): State {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>
      const base = emptyState()
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        streak: { ...base.streak, ...(parsed.streak ?? {}) },
      }
    }
  } catch {
    // 数据损坏时回到初始状态
  }
  return emptyState()
}

function reorder<T extends { id: string; order: number }>(list: T[], id: string, dir: -1 | 1): T[] {
  const sorted = [...list].sort((a, b) => a.order - b.order)
  const i = sorted.findIndex((x) => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= sorted.length) return list
  ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
  return sorted.map((x, idx) => ({ ...x, order: idx }))
}

function touchStreak(state: State, active: boolean): State['streak'] {
  if (!active) return state.streak
  const date = todayStr()
  const s = state.streak
  if (s.lastActive === date) return s
  if (s.lastActive != null && s.lastActive === addDays(date, -1)) {
    const cur = s.current + 1
    return { current: cur, best: Math.max(s.best, cur), lastActive: date }
  }
  return { current: 1, best: Math.max(s.best, 1), lastActive: date }
}

/** 在某天的任务列表中登记完成,发放经验与全勤奖励 */
function settleTasks(
  state: State,
  date: string,
  list: Task[],
  completingTaskId: string | null
): { tasks: Record<string, Task[]>; gained: number; allDoneBonus: string[] } {
  let gained = 0
  let allDoneBonus = state.allDoneBonus
  let completed = false
  const newList = list.map((t) => {
    if (completingTaskId != null && t.id === completingTaskId && !t.done) {
      completed = true
      return { ...t, done: true }
    }
    return t
  })
  if (completed) {
    const t = list.find((x) => x.id === completingTaskId)
    gained += t?.xp ?? 0
  }
  if (newList.length > 0 && !newList.some((t) => !t.done) && !allDoneBonus.includes(date)) {
    allDoneBonus = [...allDoneBonus, date]
    gained += XP_RULES.dailyAllDone
  }
  return { tasks: { ...state.tasks, [date]: newList }, gained, allDoneBonus }
}

export type Action =
  | { type: 'HYDRATE'; state: State }
  | { type: 'INIT_WITH_SEED'; profile: Profile; seed: SeedData }
  | { type: 'MERGE_CATALOG'; catalog: CatalogData }
  | { type: 'UPDATE_PROFILE'; patch: Partial<Profile> }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'ADD_SUBJECT'; subject: Subject }
  | { type: 'UPDATE_SUBJECT'; id: string; patch: Partial<Subject> }
  | { type: 'DELETE_SUBJECT'; id: string }
  | { type: 'ADD_CHAPTER'; chapter: Chapter }
  | { type: 'UPDATE_CHAPTER'; id: string; patch: Partial<Chapter> }
  | { type: 'DELETE_CHAPTER'; id: string }
  | { type: 'ADD_KP'; kp: KnowledgePoint }
  | { type: 'UPDATE_KP'; id: string; patch: Partial<KnowledgePoint> }
  | { type: 'DELETE_KP'; id: string }
  | { type: 'MOVE_ITEM'; kind: 'subject' | 'chapter' | 'kp'; id: string; dir: -1 | 1; parentId?: string }
  | { type: 'IMPORT_OUTLINE'; subjectId: string; chapters: { name: string; kps: string[] }[] }
  | { type: 'ADD_QUESTIONS'; questions: Question[] }
  | { type: 'UPDATE_QUESTION'; id: string; patch: Partial<Question> }
  | { type: 'DELETE_QUESTION'; id: string }
  | { type: 'START_SESSION'; session: Session }
  | { type: 'ANSWER'; questionId: string; userAnswer: string; correct: boolean; mode: PracticeMode }
  | { type: 'ADVANCE_SESSION' }
  | { type: 'END_SESSION'; summary: SessionSummary }
  | { type: 'SET_TASKS'; date: string; tasks: Task[] }
  | { type: 'UPDATE_TASK'; date: string; taskId: string; patch: Partial<Task> }
  | { type: 'POSTPONE_TASK'; date: string; taskId: string }
  | { type: 'MOVE_TASK'; date: string; taskId: string; dir: -1 | 1 }
  | { type: 'ADD_STUDY_TIME'; date: string; seconds: number }
  | { type: 'TOGGLE_FAVORITE'; questionId: string }
  | { type: 'SET_QUESTION_NOTE'; questionId: string; note: string }
  | { type: 'SET_WRONG_REASON'; questionId: string; reason: WrongReason }
  | { type: 'ARCHIVE_WRONG'; questionId: string; archived: boolean }
  | { type: 'HIDE_HOT'; questionId: string }
  | { type: 'SET_UPDATE_CHECKED'; t: number }
  | { type: 'SET_APP_UPDATE_CHECKED'; t: number }
  | { type: 'RECORD_OFFICE_RESULT'; taskId: string; result: OfficeResultRecord }
  | { type: 'REMOVE_QUESTIONS_FORCE'; ids: string[] }
  | { type: 'REVIEW_QUESTIONS'; ids: string[]; pass: boolean }
  | { type: 'LOG'; text: string }
  | { type: 'TOGGLE_WORD_MASTERED'; word: string }
  | { type: 'CHECKIN'; date: string; count: number }
  | { type: 'IMPORT_STATE'; state: State }
  | { type: 'RESET' }

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return action.state
    case 'IMPORT_STATE':
      return { ...emptyState(), ...action.state }
    case 'RESET':
      return emptyState()

    case 'INIT_WITH_SEED': {
      const kps: KnowledgePoint[] = action.seed.kps.map((k) => ({
        ...k,
        status: 'unlearned',
        notes: '',
        stats: emptyStats(),
        mastery: null,
      }))
      const questions: Question[] = action.seed.questions.map((q) => ({ ...q, createdAt: new Date().toISOString() }))
      const base: State = {
        ...state,
        onboarded: true,
        profile: action.profile,
        subjects: action.seed.subjects,
        chapters: action.seed.chapters,
        kps,
        questions,
        seedLoaded: true,
        session: null,
      }
      const date = todayStr()
      return { ...base, tasks: { ...base.tasks, [date]: generateTasks(base, date) } }
    }

    case 'UPDATE_PROFILE':
      return { ...state, profile: state.profile ? { ...state.profile, ...action.patch } : state.profile }
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } }

    /** 合并考试类别内容包:只新增、永不删除或覆盖用户已有内容(幂等)。
     *  例外一:meta.removeSubjectIds 声明"被取代"的科目(如旧通用《高等数学》),
     *  按版本一次性级联清除,避免重复。
     *  例外二:meta.removeQuestionIds 声明被山东专升本导向题目取代的旧示例题。 */
    case 'MERGE_CATALOG': {
      const cat = action.catalog
      const removeIds = new Set(cat.meta.removeSubjectIds ?? [])
      const removeQ = new Set(cat.meta.removeQuestionIds ?? [])
      let next = state
      if (removeIds.size > 0) {
        const chapterIds = new Set(next.chapters.filter((c) => removeIds.has(c.subjectId)).map((c) => c.id))
        const removedKpIds = new Set(next.kps.filter((k) => chapterIds.has(k.chapterId) || removeIds.has(k.subjectId)).map((k) => k.id))
        const removedQIds = new Set(next.questions.filter((q) => removedKpIds.has(q.kpId) || removeIds.has(q.subjectId)).map((q) => q.id))
        const wrong = { ...next.wrong }
        for (const qid of removedQIds) delete wrong[qid]
        next = {
          ...next,
          subjects: next.subjects.filter((s) => !removeIds.has(s.id)),
          chapters: next.chapters.filter((c) => !chapterIds.has(c.id)),
          kps: next.kps.filter((k) => !removedKpIds.has(k.id)),
          questions: next.questions.filter((q) => !removedQIds.has(q.id)),
          attempts: next.attempts.filter((a) => !removedQIds.has(a.questionId)),
          wrong,
          favorites: next.favorites.filter((f) => !removedQIds.has(f)),
          hiddenHot: next.hiddenHot.filter((f) => !removedQIds.has(f)),
        }
      }
      // 被山东专升本导向题目取代的旧示例题(错题本同步清理)
      if (removeQ.size > 0) {
        const wrong2 = { ...next.wrong }
        for (const qid of removeQ) delete wrong2[qid]
        next = {
          ...next,
          questions: next.questions.filter((q) => !removeQ.has(q.id)),
          wrong: wrong2,
          favorites: next.favorites.filter((f) => !removeQ.has(f)),
          hiddenHot: next.hiddenHot.filter((f) => !removeQ.has(f)),
        }
      }
      const state2 = next
      const subjIds = new Set(state2.subjects.map((s) => s.id))
      const legacyIds = new Set(cat.meta.legacySubjectIds ?? [])
      // 合并时补全考纲元数据(只填缺失字段,不覆盖任何已有内容)
      const catSubj = new Map(cat.subjects.map((s) => [s.id, s]))
      const catChap = new Map(cat.chapters.map((c) => [c.id, c]))
      const stamped = state2.subjects.map((s) => {
        let out = s
        if (legacyIds.has(s.id)) {
          // 旧版通用《高等数学》(s2) 已被 Ⅰ/Ⅱ/Ⅲ 三个科目取代:选定考试类别后隐藏,数据保留
          out = s.id === 's2' ? { ...s, legacy: true, applicableCategories: [] as never[] } : { ...s, legacy: true }
        }
        const cs = catSubj.get(s.id)
        if (cs?.syllabus && !out.syllabus) out = { ...out, syllabus: cs.syllabus }
        return out
      })
      const newSubjects = cat.subjects.filter((s) => !subjIds.has(s.id))
      const chapIds = new Set(state2.chapters.map((c) => c.id))
      const newChapters = cat.chapters.filter((c) => !chapIds.has(c.id))
      // 为已有章节补全考纲考查要求与来源(只填缺失)
      const enrichedChapters = state2.chapters.map((c) => {
        const cc = catChap.get(c.id)
        if (cc && !c.requirement && (cc as { requirement?: string }).requirement) {
          return { ...c, requirement: (cc as { requirement?: string }).requirement, source: (cc as { source?: string }).source }
        }
        return c
      })
      const kpIds = new Set(state2.kps.map((k) => k.id))
      const newKps: KnowledgePoint[] = cat.kps
        .filter((k) => !kpIds.has(k.id))
        .map((k) => ({ ...k, status: 'unlearned', notes: '', stats: emptyStats(), mastery: null }))
      const qIds = new Set(state2.questions.map((q) => q.id))
      const newQuestions: Question[] = (cat.questions ?? [])
        .filter((q) => !qIds.has(q.id))
        .map((q) => ({ ...q, createdAt: new Date().toISOString() }))
      if (newSubjects.length === 0 && newChapters.length === 0 && newKps.length === 0 && newQuestions.length === 0 && (state2.catalogVersion ?? 0) >= CATALOG_VERSION) {
        return state2
      }
      return {
        ...state2,
        subjects: [...stamped, ...newSubjects],
        chapters: [...enrichedChapters, ...newChapters],
        kps: [...state2.kps, ...newKps],
        questions: [...state2.questions, ...newQuestions],
        catalogVersion: Math.max(CATALOG_VERSION, cat.meta.version ?? 0),
      }
    }

    case 'ADD_SUBJECT':
      return { ...state, subjects: [...state.subjects, action.subject] }
    case 'UPDATE_SUBJECT':
      return { ...state, subjects: state.subjects.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)) }
    case 'DELETE_SUBJECT': {
      const chapterIds = new Set(state.chapters.filter((c) => c.subjectId === action.id).map((c) => c.id))
      const kpIds = new Set(state.kps.filter((k) => chapterIds.has(k.chapterId)).map((k) => k.id))
      const wrong = { ...state.wrong }
      for (const q of state.questions) {
        if (kpIds.has(q.kpId)) delete wrong[q.id]
      }
      return {
        ...state,
        subjects: state.subjects.filter((s) => s.id !== action.id),
        chapters: state.chapters.filter((c) => !chapterIds.has(c.id)),
        kps: state.kps.filter((k) => !kpIds.has(k.id)),
        questions: state.questions.filter((q) => !kpIds.has(q.kpId)),
        wrong,
      }
    }

    case 'ADD_CHAPTER':
      return { ...state, chapters: [...state.chapters, action.chapter] }
    case 'UPDATE_CHAPTER':
      return { ...state, chapters: state.chapters.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)) }
    case 'DELETE_CHAPTER': {
      const kpIds = new Set(state.kps.filter((k) => k.chapterId === action.id).map((k) => k.id))
      const wrong = { ...state.wrong }
      for (const q of state.questions) {
        if (kpIds.has(q.kpId)) delete wrong[q.id]
      }
      return {
        ...state,
        chapters: state.chapters.filter((c) => c.id !== action.id),
        kps: state.kps.filter((k) => !kpIds.has(k.id)),
        questions: state.questions.filter((q) => !kpIds.has(q.kpId)),
        wrong,
      }
    }

    case 'ADD_KP':
      return { ...state, kps: [...state.kps, action.kp] }
    case 'UPDATE_KP':
      return { ...state, kps: state.kps.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)) }
    case 'DELETE_KP': {
      const wrong = { ...state.wrong }
      for (const q of state.questions) {
        if (q.kpId === action.id) delete wrong[q.id]
      }
      return {
        ...state,
        kps: state.kps.filter((k) => k.id !== action.id),
        questions: state.questions.filter((q) => q.kpId !== action.id),
        wrong,
      }
    }

    case 'MOVE_ITEM': {
      if (action.kind === 'subject') {
        return { ...state, subjects: reorder(state.subjects, action.id, action.dir) }
      }
      if (action.kind === 'chapter') {
        const group = state.chapters.filter((c) => c.subjectId === action.parentId)
        const moved = reorder(group, action.id, action.dir)
        const ids = new Set(moved.map((m) => m.id))
        return { ...state, chapters: [...state.chapters.filter((c) => !ids.has(c.id)), ...moved] }
      }
      const group = state.kps.filter((k) => k.chapterId === action.parentId)
      const moved = reorder(group, action.id, action.dir)
      const ids = new Set(moved.map((m) => m.id))
      return { ...state, kps: [...state.kps.filter((k) => !ids.has(k.id)), ...moved] }
    }

    case 'IMPORT_OUTLINE': {
      const subjectChapters = state.chapters.filter((c) => c.subjectId === action.subjectId)
      let chOrder = subjectChapters.reduce((m, c) => Math.max(m, c.order), -1) + 1
      const newChapters: Chapter[] = []
      const newKps: KnowledgePoint[] = []
      for (const ch of action.chapters) {
        const existing = state.chapters.find(
          (c) => c.subjectId === action.subjectId && c.name.trim() === ch.name.trim()
        )
        let chapterId: string
        if (existing) {
          chapterId = existing.id
        } else {
          chapterId = uid('c')
          newChapters.push({ id: chapterId, subjectId: action.subjectId, name: ch.name, order: chOrder++ })
        }
        let kpOrder = state.kps.filter((k) => k.chapterId === chapterId).length
        for (const name of ch.kps) {
          const dup =
            state.kps.some((k) => k.chapterId === chapterId && k.name.trim() === name.trim()) ||
            newKps.some((k) => k.chapterId === chapterId && k.name.trim() === name.trim())
          if (dup) continue
          newKps.push({
            id: uid('k'),
            subjectId: action.subjectId,
            chapterId,
            name,
            order: kpOrder++,
            status: 'unlearned',
            notes: '',
            stats: emptyStats(),
            mastery: null,
          })
        }
      }
      return { ...state, chapters: [...state.chapters, ...newChapters], kps: [...state.kps, ...newKps] }
    }

    case 'ADD_QUESTIONS':
      return { ...state, questions: [...state.questions, ...action.questions] }
    case 'UPDATE_QUESTION':
      return { ...state, questions: state.questions.map((q) => (q.id === action.id ? { ...q, ...action.patch } : q)) }
    case 'DELETE_QUESTION': {
      const wrong = { ...state.wrong }
      delete wrong[action.id]
      return {
        ...state,
        questions: state.questions.filter((q) => q.id !== action.id),
        favorites: state.favorites.filter((f) => f !== action.id),
        wrong,
      }
    }

    case 'START_SESSION':
      return { ...state, session: action.session }

    case 'ANSWER': {
      const q = state.questions.find((x) => x.id === action.questionId)
      if (!q) return state
      const date = todayStr()
      const nowIso = new Date().toISOString()
      const intervals = state.settings.intervals

      // 1. 作答记录
      const attempt: Attempt = {
        id: uid('a'),
        questionId: q.id,
        kpId: q.kpId,
        subjectId: q.subjectId,
        correct: action.correct,
        userAnswer: action.userAnswer,
        mode: action.mode,
        at: nowIso,
        date,
      }
      const attempts = [...state.attempts, attempt]

      // 2. 错题本与间隔复习
      let wrong = state.wrong
      const prev = state.wrong[q.id]
      let reviewXp = 0
      if (!action.correct) {
        wrong = { ...wrong, [q.id]: entryOnWrong(prev, q, intervals, date, nowIso, action.userAnswer) }
      } else if (prev && !prev.archived && prev.nextReviewAt != null) {
        if (prev.nextReviewAt <= date) {
          wrong = { ...wrong, [q.id]: entryOnCorrectReview(prev, intervals, date) }
          reviewXp = XP_RULES.reviewCorrect
        } else {
          wrong = { ...wrong, [q.id]: entryOnEarlyCorrect(prev, date) }
        }
      }

      // 3. 知识点统计 / 掌握度 / 状态
      let kps = state.kps
      let masterXp = 0
      if (state.kps.some((k) => k.id === q.kpId)) {
        const kp = state.kps.find((k) => k.id === q.kpId)!
        const stats: KPStats = { ...kp.stats, attempts: kp.stats.attempts + 1 }
        if (action.correct) stats.correct += 1
        else stats.wrongCount += 1
        stats.lastPracticedAt = nowIso
        stats.streak = action.correct ? kp.stats.streak + 1 : 0
        const kpAtts = attempts.filter((a) => a.kpId === kp.id)
        const m = computeKpMastery({ ...kp, stats }, kpAtts, (a) => {
          const qq = state.questions.find((x) => x.id === a.questionId)
          return difficultyWeight(qq?.difficulty ?? 1)
        })
        const status = nextStatus(kp.status, action.correct, m, stats.attempts)
        if (status === 'mastered' && kp.status !== 'mastered') masterXp = XP_RULES.masterKp
        kps = state.kps.map((k) => (k.id === kp.id ? { ...kp, stats, status, mastery: m } : k))
      }

      // 4. 答题经验(每日上限,同一题每天只计一次,防刷)
      const cap = state.settings.dailyPracticeXpCap
      const used = state.practiceXpDate === date ? state.practiceXpToday : 0
      const already = state.attempts.some((a) => a.questionId === q.id && a.date === date)
      const want = already ? 0 : action.correct ? XP_RULES.attemptCorrect : XP_RULES.attemptWrong
      const grantAttempt = Math.max(0, Math.min(want, cap - used))
      const grantReview = Math.max(0, Math.min(reviewXp, cap - used - grantAttempt))

      // 5. 任务进度(关联任务时)
      let tasks = state.tasks
      let taskXp = 0
      let allDoneBonus = state.allDoneBonus
      if (state.session?.taskId) {
        const list = state.tasks[date] ?? []
        let completingId: string | null = null
        const progressed = list.map((t) => {
          if (t.id !== state.session!.taskId || t.done) return t
          const progress = t.progress + 1
          if (progress >= Math.max(1, t.questionCount)) {
            completingId = t.id
            return { ...t, progress }
          }
          return { ...t, progress }
        })
        const r = settleTasks(state, date, progressed, completingId)
        taskXp = r.gained
        tasks = r.tasks
        allDoneBonus = r.allDoneBonus
      }
      const totalXp = grantAttempt + grantReview + taskXp + masterXp
      let xpLog = state.xpLog
      if (grantAttempt > 0) xpLog = pushXpLog(xpLog, grantAttempt, action.correct ? '练习答对' : '完成练习')
      if (grantReview > 0) xpLog = pushXpLog(xpLog, grantReview, '错题复习')
      if (taskXp > 0) xpLog = pushXpLog(xpLog, taskXp, '完成学习任务')
      if (masterXp > 0) xpLog = pushXpLog(xpLog, masterXp, '掌握新知识点')

      // 6. 更新会话
      const session: Session | null = state.session
        ? {
            ...state.session,
            answers: { ...state.session.answers, [q.id]: { userAnswer: action.userAnswer, correct: action.correct } },
            xpGained: state.session.xpGained + totalXp,
          }
        : null

      return {
        ...state,
        attempts,
        wrong,
        kps,
        tasks,
        allDoneBonus,
        streak: touchStreak(state, totalXp > 0),
        xp: state.xp + totalXp,
        xpLog,
        practiceXpDate: date,
        practiceXpToday: used + grantAttempt + grantReview,
        session,
      }
    }

    case 'ADVANCE_SESSION':
      return state.session ? { ...state, session: { ...state.session, index: state.session.index + 1 } } : state

    case 'END_SESSION':
      return { ...state, session: null, lastSummary: action.summary }

    case 'SET_TASKS':
      return { ...state, tasks: { ...state.tasks, [action.date]: action.tasks } }

    case 'UPDATE_TASK': {
      const list = state.tasks[action.date] ?? []
      const completing = action.patch.done === true && !list.find((t) => t.id === action.taskId)?.done
      const patched = list.map((t) => (t.id === action.taskId ? { ...t, ...action.patch } : t))
      const r = settleTasks(state, action.date, patched, completing ? action.taskId : null)
      return {
        ...state,
        tasks: r.tasks,
        allDoneBonus: r.allDoneBonus,
        xp: state.xp + r.gained,
        xpLog: r.gained > 0 ? pushXpLog(state.xpLog, r.gained, '完成学习任务') : state.xpLog,
        streak: touchStreak(state, r.gained > 0),
      }
    }

    case 'POSTPONE_TASK': {
      const list = state.tasks[action.date] ?? []
      const t = list.find((x) => x.id === action.taskId)
      if (!t) return state
      const rest = list.filter((x) => x.id !== action.taskId)
      const next = addDays(action.date, 1)
      const nextList = [...(state.tasks[next] ?? []), { ...t, progress: 0 }]
      return { ...state, tasks: { ...state.tasks, [action.date]: rest, [next]: nextList } }
    }

    case 'MOVE_TASK': {
      const list = [...(state.tasks[action.date] ?? [])]
      const i = list.findIndex((t) => t.id === action.taskId)
      const j = i + action.dir
      if (i < 0 || j < 0 || j >= list.length) return state
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...state, tasks: { ...state.tasks, [action.date]: list } }
    }

    case 'ADD_STUDY_TIME': {
      const cur = state.studyTime[action.date] ?? 0
      return { ...state, studyTime: { ...state.studyTime, [action.date]: cur + action.seconds } }
    }

    case 'TOGGLE_FAVORITE':
      return {
        ...state,
        favorites: state.favorites.includes(action.questionId)
          ? state.favorites.filter((f) => f !== action.questionId)
          : [...state.favorites, action.questionId],
      }

    case 'SET_QUESTION_NOTE':
      return { ...state, questionNotes: { ...state.questionNotes, [action.questionId]: action.note } }

    case 'SET_WRONG_REASON':
      return state.wrong[action.questionId]
        ? { ...state, wrong: { ...state.wrong, [action.questionId]: { ...state.wrong[action.questionId], reason: action.reason } } }
        : state

    case 'ARCHIVE_WRONG':
      return state.wrong[action.questionId]
        ? {
            ...state,
            wrong: {
              ...state.wrong,
              [action.questionId]: {
                ...state.wrong[action.questionId],
                archived: action.archived,
                nextReviewAt: action.archived ? null : addDays(todayStr(), state.settings.intervals[0]),
                streakCorrect: action.archived ? state.wrong[action.questionId].streakCorrect : 0,
              },
            },
          }
        : state

    case 'HIDE_HOT':
      return {
        ...state,
        hiddenHot: state.hiddenHot.includes(action.questionId)
          ? state.hiddenHot
          : [...state.hiddenHot, action.questionId],
      }

    case 'SET_UPDATE_CHECKED':
      return { ...state, lastUpdateCheck: action.t }

    case 'SET_APP_UPDATE_CHECKED':
      return { ...state, lastAppUpdateCheck: action.t }

    case 'RECORD_OFFICE_RESULT':
      return {
        ...state,
        officeResults: { ...(state.officeResults ?? {}), [action.taskId]: action.result },
      }

    /** 一次性数据修复:强制清除不符合山东专升本考纲的遗留题 */
    case 'REMOVE_QUESTIONS_FORCE': {
      const ids = new Set(action.ids)
      const wrong = { ...state.wrong }
      for (const qid of ids) delete wrong[qid]
      return {
        ...state,
        questions: state.questions.filter((q) => !ids.has(q.id)),
        wrong,
        favorites: state.favorites.filter((f) => !ids.has(f)),
        hiddenHot: state.hiddenHot.filter((f) => !ids.has(f)),
      }
    }

    /** 题目审核:通过 → 标记已审核;不通过 → 删除 */
    case 'REVIEW_QUESTIONS': {
      const ids = new Set(action.ids)
      let qaLog = state.qaLog ?? []
      if (action.pass) {
        return {
          ...state,
          questions: state.questions.map((q) => (ids.has(q.id) ? { ...q, reviewed: true } : q)),
          qaLog: [{ t: Date.now(), text: `审核通过 ${ids.size} 道题目` }, ...qaLog].slice(0, 50),
        }
      }
      const wrong = { ...state.wrong }
      for (const qid of ids) delete wrong[qid]
      qaLog = [{ t: Date.now(), text: `审核不通过,删除 ${ids.size} 道题目` }, ...qaLog].slice(0, 50)
      return {
        ...state,
        questions: state.questions.filter((q) => !ids.has(q.id)),
        wrong,
        favorites: state.favorites.filter((f) => !ids.has(f)),
        qaLog,
      }
    }

    case 'LOG':
      return { ...state, qaLog: [{ t: Date.now(), text: action.text }, ...(state.qaLog ?? [])].slice(0, 50) }

    case 'TOGGLE_WORD_MASTERED': {
      const eng = state.english ?? { checkedDates: [], mastered: [] }
      return {
        ...state,
        english: {
          ...eng,
          mastered: eng.mastered.includes(action.word)
            ? eng.mastered.filter((w) => w !== action.word)
            : [...eng.mastered, action.word],
        },
      }
    }

    case 'CHECKIN': {
      const eng = state.english ?? { checkedDates: [], mastered: [] }
      if (eng.checkedDates.includes(action.date)) return state
      return {
        ...state,
        english: { ...eng, checkedDates: [...eng.checkedDates, action.date].sort() },
        qaLog: [{ t: Date.now(), text: `英语打卡:${action.date},学习 ${action.count} 词` }, ...(state.qaLog ?? [])].slice(0, 50),
      }
    }

    default:
      return state
  }
}

const StoreCtx = createContext<{
  state: State
  dispatch: Dispatch<Action>
  undo: () => void
} | null>(null)

export function useStore(): { state: State; dispatch: Dispatch<Action>; undo: () => void } {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('StoreProvider 缺失')
  return v
}

const UNDO_LABELS: Partial<Record<Action['type'], string>> = {
  DELETE_SUBJECT: '已删除科目(含其章节/知识点/题目)',
  DELETE_CHAPTER: '已删除章节(含其知识点/题目)',
  DELETE_KP: '已删除知识点(含其题目)',
  DELETE_QUESTION: '已删除题目',
}

export function StoreProvider({
  children,
  storageKey = STORAGE_KEY,
}: {
  children: ReactNode
  storageKey?: string
}) {
  const cloudSession = getSession()
  const [state, dispatch] = useReducer(reducer, storageKey, load)
  const [cloudReady, setCloudReady] = React.useState(!cloudSession?.cloudToken || !cloudSession.cloudApiUrl)
  const stateRef = useRef(state)
  stateRef.current = state
  const undoStack = useRef<{ state: State }[]>([])
  const keyRef = useRef(storageKey)
  keyRef.current = storageKey

  // Remote state wins on a newly logged-in device. If it does not exist yet, upload this device's local history.
  useEffect(() => {
    const token = cloudSession?.cloudToken
    const apiUrl = cloudSession?.cloudApiUrl
    if (!token || !apiUrl) {
      setCloudReady(true)
      return
    }

    let cancelled = false
    setCloudReady(false)
    downloadCloudState({ token, apiUrl }).then(async (remoteState) => {
      if (cancelled) return
      if (remoteState) dispatch({ type: 'HYDRATE', state: remoteState })
      else await uploadCloudState({ token, apiUrl }, stateRef.current)
      if (!cancelled) setCloudReady(true)
    }).catch(() => {
      if (!cancelled) setCloudReady(true)
    })

    return () => { cancelled = true }
  }, [cloudSession?.cloudToken, cloudSession?.cloudApiUrl])

  const dispatchWrapped = useCallback((action: Action) => {
    if (UNDO_LABELS[action.type]) {
      undoStack.current.push({ state: stateRef.current })
      if (undoStack.current.length > 5) undoStack.current.shift()
    }
    dispatch(action)
  }, [])

  const undo = useCallback(() => {
    const item = undoStack.current.pop()
    if (item) dispatch({ type: 'HYDRATE', state: item.state })
  }, [])

  // 防抖持久化
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(keyRef.current, JSON.stringify(state))
      } catch {
        // 存储已满等场景静默失败
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [state])

  // Keep cloud and local snapshots aligned. A failed request leaves local learning fully usable and retries on the next change.
  useEffect(() => {
    const token = cloudSession?.cloudToken
    const apiUrl = cloudSession?.cloudApiUrl
    if (!cloudReady || !token || !apiUrl) return
    const timer = window.setTimeout(() => {
      void uploadCloudState({ token, apiUrl }, state)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [state, cloudReady, cloudSession?.cloudToken, cloudSession?.cloudApiUrl])

  // 关键时刻立即落盘
  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(keyRef.current, JSON.stringify(stateRef.current))
      } catch {
        // ignore
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // 启动时合并考试类别内容包(老用户也能拿到新增科目/知识点/题目)
  useEffect(() => {
    if (!state.onboarded) return
    if ((state.catalogVersion ?? 0) >= CATALOG_VERSION) return
    let cancelled = false
    import('../lib/seed').then(({ loadCatalog }) =>
      loadCatalog().then((cat) => {
        if (!cancelled) dispatch({ type: 'MERGE_CATALOG', catalog: cat })
      })
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.onboarded, state.catalogVersion])

  // 一次性数据修复:清除不符合山东专升本考纲的遗留题(与考纲无关的通用学习方法题等)
  useEffect(() => {
    if (!state.onboarded) return
    const FORCED_REMOVE = ['q602']
    const hit = state.questions.filter((q) => FORCED_REMOVE.includes(q.id))
    if (hit.length === 0) return
    dispatch({ type: 'REMOVE_QUESTIONS_FORCE', ids: FORCED_REMOVE })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.onboarded])

  // 自动更新:配置了更新源时,每天静默检查一次远端内容包(考纲/题目更新后自动合并)
  useEffect(() => {
    const url = state.settings.updateSourceUrl
    if (!state.onboarded || !url) return
    const last = state.lastUpdateCheck ?? 0
    if (Date.now() - last < 24 * 3600 * 1000) return
    let cancelled = false
    import('../lib/seed').then(({ fetchRemoteCatalog }) =>
      fetchRemoteCatalog(url).then((cat) => {
        if (cancelled) return
        if (cat && (cat.meta.version ?? 0) > (stateRef.current.catalogVersion ?? 0)) {
          dispatch({ type: 'MERGE_CATALOG', catalog: cat })
        }
        dispatch({ type: 'SET_UPDATE_CHECKED', t: Date.now() })
      })
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.onboarded, state.settings.updateSourceUrl, state.lastUpdateCheck])

  return <StoreCtx.Provider value={{ state, dispatch: dispatchWrapped, undo }}>{children}</StoreCtx.Provider>
}

import { describe, expect, it } from 'vitest'
import { generateTasks, regenerateTasks } from '../src/lib/plan'
import { emptyStats } from '../src/store/store'
import type { KnowledgePoint, State, WrongEntry } from '../src/types'
import { addDays, todayStr } from '../src/lib/date'

function makeState(partial?: {
  category?: 'gj1' | 'gj2' | 'gj3'
  examDate?: string
  dailyMinutes?: number
  weeklyDays?: number
  wrongDue?: boolean
}): State {
  const today = todayStr()
  const kp = (id: string, subjectId: string): KnowledgePoint => ({
    id, subjectId, chapterId: `c-${subjectId}`, name: `点-${id}`, status: 'unlearned',
    order: 0, notes: '', stats: emptyStats(), mastery: null,
  })
  const wrong: Record<string, WrongEntry> = {}
  if (partial?.wrongDue) {
    wrong['q1'] = {
      questionId: 'q1', kpId: 'k1', subjectId: 's-m1', wrongCount: 1,
      firstWrongAt: today, lastWrongAt: today, lastUserAnswer: 'B', correctAnswer: 'A',
      reason: null, intervalIndex: 0, streakCorrect: 0, reviewLog: [],
      nextReviewAt: addDays(today, -1), archived: false,
    }
  }
  return {
    version: 1, onboarded: true,
    profile: {
      nickname: '测试', avatar: 'sprout', theme: 'sky', major: '计算机',
      category: partial?.category, elective: 'english',
      examDate: partial?.examDate ?? addDays(today, 60), syllabusYear: 2026,
      baseLevel: 'basic', dailyMinutes: partial?.dailyMinutes ?? 60, weeklyDays: partial?.weeklyDays ?? 7,
      createdAt: new Date().toISOString(),
    },
    subjects: [
      { id: 's-m1', name: '高等数学Ⅰ', color: '#000', targetScore: 60, order: 0, applicableCategories: ['gj1'] },
      { id: 's-m2', name: '高等数学Ⅱ', color: '#000', targetScore: 60, order: 1, applicableCategories: ['gj2'] },
    ],
    chapters: [],
    kps: [kp('k1', 's-m1'), kp('k2', 's-m1'), kp('k3', 's-m2')],
    questions: [
      { id: 'q1', subjectId: 's-m1', chapterId: 'c-s-m1', kpId: 'k1', type: 'single', stem: 's', options: [], answer: 'A', explanation: 'e', difficulty: 1, source: 't', year: 2025, official: false, createdAt: '' },
    ],
    attempts: [], wrong, tasks: {}, session: null, lastSummary: null,
    xp: 0, xpLog: [], practiceXpDate: '', practiceXpToday: 0,
    streak: { current: 0, best: 0, lastActive: null },
    studyTime: {}, favorites: [], questionNotes: {}, allDoneBonus: [],
    settings: { intervals: [1, 3, 7, 14, 30], dailyPracticeXpCap: 120, reduceMotion: false, mascotEnabled: true },
    seedLoaded: true, catalogVersion: 4, hiddenHot: [],
  }
}

describe('每日计划生成', () => {
  it('到期错题优先出现在任务中', () => {
    const tasks = generateTasks(makeState({ wrongDue: true }), todayStr())
    const review = tasks.find((t) => t.type === 'reviewWrong')
    expect(review).toBeTruthy()
    expect(review!.questionCount).toBe(1)
  })

  it('选定类别后只安排范围内科目的知识点(高教一类不排高数Ⅱ)', () => {
    const tasks = generateTasks(makeState({ category: 'gj1' }), todayStr())
    const learn = tasks.find((t) => t.type === 'learnKP')
    expect(learn).toBeTruthy()
    // 范围内只有 s-m1 的 k1/k2 两个知识点
    expect((learn!.kpIds ?? []).every((id) => id !== 'k3')).toBe(true)
  })

  it('每天可用时间很少时新课数量受限', () => {
    const tasks = generateTasks(makeState({ category: 'gj1', dailyMinutes: 30 }), todayStr())
    const learn = tasks.find((t) => t.type === 'learnKP')
    expect((learn?.kpIds ?? []).length).toBeLessThanOrEqual(1)
  })

  it('重新生成保留已完成任务', () => {
    const state = makeState({ category: 'gj1', wrongDue: true })
    const first = generateTasks(state, todayStr())
    const withDone: State = { ...state, tasks: { [todayStr()]: first.map((t, i) => (i === 0 ? { ...t, done: true, progress: t.questionCount } : t)) } }
    const merged = regenerateTasks(withDone, todayStr())
    expect(merged.filter((t) => t.done).length).toBe(1)
    // 已完成的任务排在最前
    expect(merged[0].done).toBe(true)
  })
})

// 模拟考试纯逻辑:组卷(按章节均匀抽题)/判分/每日一题(确定性抽取),全部可测试
import type { Question, State } from '../types'
import { checkAnswer } from './misc'
import { subjectInScope } from './selectors'

/** 科目可用题(范围内科目 + 有答案的题) */
export function eligibleQuestions(state: State, subjectId: string): Question[] {
  if (subjectId !== 'all') {
    return state.questions.filter((q) => q.subjectId === subjectId && q.answer)
  }
  return state.questions.filter((q) => {
    const s = state.subjects.find((x) => x.id === q.subjectId)
    return q.answer && s && subjectInScope(state, s)
  })
}

/** 组卷:按章节轮流抽取(保证覆盖面),章节内随机 */
export function buildPaper(questions: Question[], count: number): Question[] {
  if (questions.length === 0) return []
  const byChapter = new Map<string, Question[]>()
  for (const q of questions) {
    const list = byChapter.get(q.chapterId) ?? []
    list.push(q)
    byChapter.set(q.chapterId, list)
  }
  // 章节内洗牌
  const lanes: Question[][] = []
  for (const list of byChapter.values()) {
    lanes.push([...list].sort(() => Math.random() - 0.5))
  }
  // 章节多则先给每章 1 题,再轮流补齐
  const picked: Question[] = []
  let lane = 0
  while (picked.length < Math.min(count, questions.length)) {
    const l = lanes[lane % lanes.length]
    const q = l.shift()
    if (q) picked.push(q)
    if (lanes.every((x) => x.length === 0)) break
    lane++
  }
  return picked.slice(0, count)
}

/** 建议时长:每题约 1.5 分钟,10-120 分钟 */
export function suggestMinutes(count: number): number {
  return Math.min(120, Math.max(10, Math.ceil(count * 1.5)))
}

export interface ExamGradedItem {
  question: Question
  userAnswer: string
  correct: boolean
  score: number
}

export interface ExamGradeResult {
  score: number
  totalScore: number
  detail: ExamGradedItem[]
  wrongIds: string[]
  correctCount: number
}

/** 判分:与题库标准答案比对;总分按题均分(保留 2 位) */
export function gradeExam(questions: Question[], answers: Record<string, string>, totalScore: number): ExamGradeResult {
  const per = questions.length > 0 ? Math.round((totalScore / questions.length) * 100) / 100 : 0
  const detail: ExamGradedItem[] = questions.map((q) => {
    const user = answers[q.id] ?? ''
    const correct = checkAnswer(q, user)
    return { question: q, userAnswer: user, correct, score: correct ? per : 0 }
  })
  const score = Math.round(detail.reduce((s, d) => s + d.score, 0) * 100) / 100
  return {
    score,
    totalScore,
    detail,
    wrongIds: detail.filter((d) => !d.correct).map((d) => d.question.id),
    correctCount: detail.filter((d) => d.correct).length,
  }
}

/** 章节得分率(成绩单用,按错题率升序) */
export function chapterBreakdown(
  detail: ExamGradedItem[],
  chapters: State['chapters'],
  totalScore: number
): { chapterId: string; name: string; score: number; total: number; rate: number }[] {
  const per = detail.length > 0 ? totalScore / detail.length : 0
  const map = new Map<string, { count: number; score: number }>()
  for (const d of detail) {
    const cur = map.get(d.question.chapterId) ?? { count: 0, score: 0 }
    cur.count++
    cur.score += d.score
    map.set(d.question.chapterId, cur)
  }
  return [...map.entries()]
    .map(([chapterId, v]) => {
      const name = chapters.find((c) => c.id === chapterId)?.name ?? '未知章节'
      const total = Math.round(v.count * per * 100) / 100
      return { chapterId, name, score: Math.round(v.score * 100) / 100, total, rate: total > 0 ? v.score / total : 0 }
    })
    .sort((a, b) => a.rate - b.rate)
}

/** 每日一题:按 日期+用户 确定性抽取(同一天同一账号必同一题),答过当天不换题 */
export function pickDailyQuestion(state: State, date: string, userId: string): Question | null {
  const pool = eligibleQuestions(state, 'all').sort((a, b) => a.id.localeCompare(b.id))
  if (pool.length === 0) return null
  let h = 2166136261
  const key = `${date}__${userId}`
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return pool[Math.abs(h) % pool.length]
}

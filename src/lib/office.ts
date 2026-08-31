// 旧版笔试型操作题兼容层（数据已归档，可按脚本恢复），以及新版可编辑材料型实操题的加载/客观核对。
import type { OfficeCheckItem, OfficeQuestion, OfficeQuestionBank, OfficeSubmission } from '../types'

export type OpKind = 'word' | 'excel' | 'ppt'
export type OpType = 'single' | 'multiple' | 'fill'

export interface OpQuestion {
  id: string
  office: OpKind
  type: OpType
  /** 材料情境 */
  material?: string
  stem: string
  options: string[]
  /** single:'B' multiple:'ABD' fill:允许多个备选答案用 | 分隔 */
  answer: string
  points: number
  analysis: string
  steps: string[]
  keyPoint: string
  commonError: string
  source: string
  year: number
  difficulty: 1 | 2 | 3
}

export interface OpBank {
  meta: { name: string; version: number; updatedAt: string; note?: string }
  questions: OpQuestion[]
}

export const OP_KIND_TEXT: Record<OpKind, string> = { word: 'Word 文字处理', excel: 'Excel 电子表格', ppt: 'PPT 演示文稿' }

let bankCache: Promise<OpBank> | null = null
let officeQuestionBankCache: Promise<OfficeQuestionBank> | null = null

const EMPTY_OFFICE_QUESTION_BANK: OfficeQuestionBank = {
  meta: {
    name: '空实操题库',
    version: 0,
    updatedAt: '',
    sourceBasis: '',
    sourceUrl: '',
    sourceSha256: '',
    note: '',
  },
  questions: [],
}

/** @deprecated V2 题库已归档；当前实操大题页面只加载 loadOfficeQuestionBank。 */
export function loadOpQuestions(): Promise<OpBank> {
  if (bankCache) return bankCache
  bankCache = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/office-tasks.json?t=${Date.now()}`)
      if (res.ok) {
        const data = (await res.json()) as OpBank
        if (Array.isArray(data.questions)) return data
      }
    } catch {
      // ignore
    }
    return { meta: { name: '空', version: 0, updatedAt: '' }, questions: [] }
  })()
  return bankCache
}

/** 加载新版材料型实操题库。题库与生成的 Office 文件一同发布，旧笔试题不再被页面引用。 */
export function loadOfficeQuestionBank(): Promise<OfficeQuestionBank> {
  if (officeQuestionBankCache) return officeQuestionBankCache
  officeQuestionBankCache = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/office-question-bank.v3.json?t=${Date.now()}`)
      if (!res.ok) return EMPTY_OFFICE_QUESTION_BANK
      const data = (await res.json()) as OfficeQuestionBank
      if (!Array.isArray(data.questions) || !data.meta) return EMPTY_OFFICE_QUESTION_BANK
      return { ...data, questions: [...data.questions].sort((a, b) => a.order - b.order) }
    } catch {
      return EMPTY_OFFICE_QUESTION_BANK
    }
  })()
  return officeQuestionBankCache
}

function normalizeOp(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s=·`'""]/g, '')
    .replace(/^=/, '')
}

/** 新版实操题“客观核对项”的判定。版式、对象位置等无法从网页可靠读取的项目仍会在页面中明确提示人工核验。 */
export function checkOfficeCheckAnswer(item: OfficeCheckItem, user: string): boolean {
  const raw = user.trim()
  if (!raw) return false
  if (item.type === 'multiple') {
    const actual = (raw.toUpperCase().match(/[A-H]/g) ?? []).sort().join('')
    const expected = (item.answer.toUpperCase().match(/[A-H]/g) ?? []).sort().join('')
    return actual !== '' && actual === expected
  }
  if (item.type === 'single') return raw.toUpperCase() === item.answer.trim().toUpperCase()
  const actual = normalizeOp(raw)
  return item.answer.split('|').some((alternative) => normalizeOp(alternative) === actual)
}

/**
 * 只根据题目定义的客观核对项给出判定；不伪造 DOCX/XLSX/PPTX 版式、动画等主观/文件级检查结果。
 */
export function gradeOfficeSubmission(
  question: OfficeQuestion,
  answers: Record<string, string>,
  at = new Date().toISOString()
): OfficeSubmission {
  const totalChecks = question.checks.length
  const correctCount = question.checks.filter((item) => checkOfficeCheckAnswer(item, answers[item.id] ?? '')).length
  const totalScore = question.scoringRubric.reduce((sum, item) => sum + item.points, 0)
  const score = totalChecks > 0 ? Math.round((totalScore * correctCount) / totalChecks) : 0
  const status: OfficeSubmission['status'] = totalChecks === 0 ? 'needsReview' : correctCount === totalChecks ? 'correct' : 'incorrect'
  return {
    questionId: question.id,
    answers,
    correctCount,
    totalChecks,
    score,
    totalScore,
    status,
    submittedAt: at,
    answerUnlockedAt: at,
  }
}

/** 判定作答:单选精确、多选字母集合、填空按多个备选答案归一化比较 */
export function checkOpAnswer(q: OpQuestion, user: string): boolean {
  const u = user.trim()
  if (!u) return false
  if (q.type === 'single') return u.toUpperCase() === q.answer.trim().toUpperCase()
  if (q.type === 'multiple') {
    const ua = (u.toUpperCase().match(/[A-H]/g) ?? []).sort().join('')
    const aa = (q.answer.toUpperCase().match(/[A-H]/g) ?? []).sort().join('')
    return ua !== '' && ua === aa
  }
  const un = normalizeOp(u)
  return q.answer.split('|').some((alt) => normalizeOp(alt) !== '' && normalizeOp(alt) === un)
}

export function totalOpPoints(questions: OpQuestion[]): number {
  return questions.reduce((s, q) => s + q.points, 0)
}

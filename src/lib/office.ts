// 山东专升本计算机操作题(笔试型):材料情境 + 单选/填空/多选,每题 2 分
// 依据:山东专升本计算机基础为闭卷笔试,操作题 15 题×2 分=30 分,考查 Office 2016 操作(自编非真题)

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

function normalizeOp(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s=·`'""]/g, '')
    .replace(/^=/, '')
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

import type { Attempt, ExamAttempt, KnowledgePoint, Question, State, WrongEntry } from '../types'
import { chapterBreakdown, gradeExam } from './exam'

export const AI_ANALYSIS_MAX_CHARS = 18000

export interface WeaknessMaterial {
  source: 'pasted' | 'wrong_book' | 'exam'
  text: string
  questionCount: number
  knowledgePoints: string[]
}

export interface AnalysisInput {
  pastedText?: string
  state: State
  exam?: ExamAttempt | null
  wrongOnly?: boolean
  maxChars?: number
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n[材料已截断，剩余内容未发送]`
}

function kpLabel(state: State, kpId: string): string {
  const kp = state.kps.find((item) => item.id === kpId)
  if (!kp) return kpId
  const chapter = state.chapters.find((item) => item.id === kp.chapterId)?.name
  const subject = state.subjects.find((item) => item.id === kp.subjectId)?.name
  return [subject, chapter, kp.name].filter(Boolean).join(' / ')
}

function questionLine(state: State, question: Question, answer: string | undefined, correct: boolean | undefined): string {
  const label = kpLabel(state, question.kpId)
  const options = question.options.length ? `选项：${question.options.join('；')}` : ''
  return [
    `题目：${clean(question.stem)}`,
    options,
    `我的答案：${clean(answer) || '未作答'}`,
    `标准答案：${clean(question.answer)}`,
    `结果：${correct == null ? '未判定' : correct ? '正确' : '错误'}`,
    `解析：${clean(question.explanation)}`,
    `知识点：${label}`,
  ].filter(Boolean).join('\n')
}

export function buildWrongBookMaterial(state: State, maxChars = AI_ANALYSIS_MAX_CHARS): WeaknessMaterial {
  const wrongEntries = Object.values(state.wrong).filter((entry) => !entry.archived)
  const blocks = wrongEntries.map((entry: WrongEntry) => {
    const question = state.questions.find((item) => item.id === entry.questionId)
    if (!question) return `知识点：${kpLabel(state, entry.kpId)}\n错误次数：${entry.wrongCount}\n我的答案：${entry.lastUserAnswer}\n标准答案：${entry.correctAnswer}`
    const attempts = state.attempts.filter((item) => item.questionId === entry.questionId && !item.correct)
    return `${questionLine(state, question, entry.lastUserAnswer, false)}\n错误次数：${entry.wrongCount}\n历史错误次数：${attempts.length}`
  })
  const text = limitText(blocks.join('\n\n'), maxChars)
  return {
    source: 'wrong_book',
    text: text || '当前没有未归档错题。',
    questionCount: wrongEntries.length,
    knowledgePoints: [...new Set(wrongEntries.map((entry) => kpLabel(state, entry.kpId)))],
  }
}

export function buildExamMaterial(state: State, exam: ExamAttempt, maxChars = AI_ANALYSIS_MAX_CHARS): WeaknessMaterial {
  const questions = exam.questionIds.map((id) => state.questions.find((item) => item.id === id)).filter((item): item is Question => Boolean(item))
  const grade = gradeExam(questions, exam.answers, exam.totalScore)
  const details = grade.detail.map((item) => questionLine(state, item.question, item.userAnswer, item.correct))
  const chapterSummary = chapterBreakdown(grade.detail, state.chapters, exam.totalScore)
    .map((item) => `${item.name}：${item.score}/${item.total}，正确率 ${Math.round(item.rate * 100)}%`)
    .join('\n')
  const text = limitText(`考试：${exam.name}\n总分：${exam.score ?? grade.score}/${exam.totalScore}\n章节表现：\n${chapterSummary}\n\n逐题材料：\n${details.join('\n\n')}`, maxChars)
  return {
    source: 'exam',
    text,
    questionCount: exam.questionIds.length,
    knowledgePoints: [...new Set(exam.questionIds.map((id) => state.questions.find((item) => item.id === id)?.kpId).filter(Boolean).map((id) => kpLabel(state, id!)))],
  }
}

export function buildPastedMaterial(state: State, pastedText: string, maxChars = AI_ANALYSIS_MAX_CHARS): WeaknessMaterial {
  const text = limitText(pastedText.trim(), maxChars)
  const knowledgePoints = state.kps
    .filter((kp) => text.includes(kp.name))
    .slice(0, 40)
    .map((kp) => kpLabel(state, kp.id))
  return { source: 'pasted', text, questionCount: 0, knowledgePoints }
}

export function buildWeaknessPrompt(input: AnalysisInput): WeaknessMaterial {
  const maxChars = input.maxChars ?? AI_ANALYSIS_MAX_CHARS
  if (input.exam) return buildExamMaterial(input.state, input.exam, maxChars)
  if (input.wrongOnly) return buildWrongBookMaterial(input.state, maxChars)
  return buildPastedMaterial(input.state, input.pastedText ?? '', maxChars)
}

export function buildKnowledgeCatalog(state: State, maxChars = 7000): string {
  const rows = state.kps.map((kp: KnowledgePoint) => `${kpLabel(state, kp.id)}｜${clean(kp.concepts)}｜${clean(kp.mistakes)}`)
  return limitText(rows.join('\n'), maxChars)
}

export function buildWeaknessMessages(material: WeaknessMaterial, state: State) {
  const catalog = buildKnowledgeCatalog(state)
  return [
    {
      role: 'system' as const,
      content: '你是山东专升本学习分析助手。只能根据用户提供的试卷、错题、作答和知识点目录分析，不得虚构题目或结论。输出清晰、可执行的中文 Markdown。必须区分“应用已有统计”和“AI 根据输入材料的判断”，不确定时明确说明。',
    },
    {
      role: 'user' as const,
      content: `请分析下面的学习材料，找出用户最欠缺的学科、章节和知识点，并给出复习顺序。请按以下结构回答：\n1. 总结结论\n2. 薄弱点表格（科目｜章节｜知识点｜证据｜置信度）\n3. 错误模式\n4. 七天复习建议\n5. 还需要补充的信息\n\n材料来源：${material.source}\n题目数量：${material.questionCount}\n\n用户材料：\n${material.text}\n\n本地知识点目录（仅用于名称匹配，不代表统计结论）：\n${catalog}`,
    },
  ]
}

// 模拟考试逻辑测试:组卷覆盖/判分/章节得分率/每日一题确定性
import { describe, expect, it } from 'vitest'
import { buildPaper, chapterBreakdown, gradeExam, pickDailyQuestion, suggestMinutes } from '../src/lib/exam'
import type { Question, State } from '../types'

function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    subjectId: 's1',
    chapterId: 'c1',
    kpId: 'k1',
    type: 'single',
    stem: '题干',
    options: ['A 选项', 'B 选项'],
    answer: 'A',
    explanation: '解析',
    difficulty: 1,
    source: '测试',
    year: 2026,
    official: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const questions: Question[] = [
  q({ id: 'q1', chapterId: 'c1' }),
  q({ id: 'q2', chapterId: 'c1', answer: 'B' }),
  q({ id: 'q3', chapterId: 'c2', type: 'multiple', answer: 'ABD' }),
  q({ id: 'q4', chapterId: 'c2', type: 'fill', answer: '2' }),
  q({ id: 'q5', chapterId: 'c3', type: 'judge', answer: 'A' }),
]

describe('模拟考试', () => {
  it('组卷数量正确且章节尽量覆盖', () => {
    const paper = buildPaper(questions, 3)
    expect(paper).toHaveLength(3)
    const chapters = new Set(paper.map((p) => p.chapterId))
    expect(chapters.size).toBeGreaterThanOrEqual(2)
    expect(buildPaper(questions, 100)).toHaveLength(5)
  })

  it('建议时长在 10-120 分钟内', () => {
    expect(suggestMinutes(5)).toBe(10)
    expect(suggestMinutes(20)).toBe(30)
    expect(suggestMinutes(200)).toBe(120)
  })

  it('判分:均分制,多选全对才得分', () => {
    const paper = [questions[0], questions[2], questions[3]] // 单选/多选/填空
    const grade = gradeExam(paper, { q1: 'A', q3: 'ABD', q4: '2' }, 90)
    expect(grade.score).toBe(90)
    expect(grade.correctCount).toBe(3)
    const half = gradeExam(paper, { q1: 'B', q3: 'AB', q4: '2' }, 90)
    expect(half.score).toBeCloseTo(30, 2) // 只有填空对
    expect(half.wrongIds).toEqual(['q1', 'q3'])
  })

  it('章节得分率按薄弱排序', () => {
    const paper = [questions[0], questions[2]]
    const grade = gradeExam(paper, { q1: 'B', q3: 'ABD' }, 100)
    const rows = chapterBreakdown(grade.detail, [{ id: 'c1', subjectId: 's1', name: '第一章', order: 0 }, { id: 'c2', subjectId: 's1', name: '第二章', order: 1 }], 100)
    expect(rows[0].rate).toBe(0) // c1 全错排最前
    expect(rows[1].rate).toBe(1)
  })

  it('每日一题:同日同账号稳定,不同日期可变化', () => {
    const state = { questions, subjects: [{ id: 's1', name: '高数Ⅰ', color: '#fff', targetScore: 0, order: 0 }], chapters: [], kps: [] } as unknown as State
    const a = pickDailyQuestion(state, '2026-09-05', 'u1')
    const b = pickDailyQuestion(state, '2026-09-05', 'u1')
    expect(a?.id).toBe(b?.id)
    const ids = new Set(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'].map((d) => pickDailyQuestion(state, d, 'u1')?.id))
    expect(ids.size).toBeGreaterThanOrEqual(2)
  })
})

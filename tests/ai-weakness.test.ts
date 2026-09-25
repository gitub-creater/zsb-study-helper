import { describe, expect, it } from 'vitest'
import { buildExamMaterial, buildPastedMaterial, buildWeaknessMessages, buildWrongBookMaterial } from '../src/lib/aiWeakness'
import type { State } from '../src/types'

function state(): State {
  return {
    version: 1, onboarded: true, profile: { nickname: '测试', avatar: 'sprout', theme: 'sky', major: '数学' } as never,
    subjects: [{ id: 's1', name: '高等数学', color: '#fff', targetScore: 100 } as never],
    chapters: [{ id: 'c1', subjectId: 's1', name: '极限', order: 1 } as never],
    kps: [{ id: 'k1', subjectId: 's1', chapterId: 'c1', name: '函数极限', status: 'learning', order: 1, notes: '', stats: { attempts: 2, correct: 0, wrongCount: 2, lastPracticedAt: null, streak: 0, reviewBonus: 0 }, mastery: 0, mistakes: '定义混淆' } as never],
    questions: [{ id: 'q1', subjectId: 's1', chapterId: 'c1', kpId: 'k1', type: 'single', stem: '求极限', options: ['A', 'B'], answer: 'A', explanation: '使用定义', difficulty: 1, source: 'test', year: 2026, official: false, createdAt: '2026-01-01' } as never],
    attempts: [], wrong: {}, tasks: {}, session: null, lastSummary: null, xp: 0, xpLog: [], practiceXpDate: '', practiceXpToday: 0, streak: { current: 0, best: 0, lastActive: null }, studyTime: {}, favorites: [], questionNotes: {}, allDoneBonus: [], settings: { intervals: [1], dailyPracticeXpCap: 100, reduceMotion: false, mascotEnabled: true, ai: { provider: 'custom', baseURL: 'https://relay.example/v1', apiKey: 'secret-key', model: 'test-model' } }, seedLoaded: true, hiddenHot: [], examHistory: [], activeExam: null,
  }
}

describe('AI 薄弱点材料整理', () => {
  it('限制用户粘贴材料长度并匹配知识点名称', () => {
    const material = buildPastedMaterial(state(), `${'函数极限 '.repeat(1000)}`, 120)
    expect(material.text.length).toBeLessThanOrEqual(120)
    expect(material.text).toContain('材料已截断')
    expect(material.knowledgePoints).toContain('高等数学 / 极限 / 函数极限')
  })

  it('把错题本整理为题目、答案、解析和知识点证据', () => {
    const s = state()
    s.wrong.q1 = { questionId: 'q1', kpId: 'k1', subjectId: 's1', wrongCount: 2, firstWrongAt: '', lastWrongAt: '', lastUserAnswer: 'B', correctAnswer: 'A', reason: null, intervalIndex: 0, streakCorrect: 0, reviewLog: [], nextReviewAt: null, archived: false }
    const material = buildWrongBookMaterial(s)
    expect(material.text).toContain('我的答案：B')
    expect(material.text).toContain('知识点：高等数学 / 极限 / 函数极限')
    expect(material.questionCount).toBe(1)
  })

  it('考试材料包含逐题判分结果且提示词不包含 API Key', () => {
    const exam = { id: 'e1', name: '数学模拟考', subjectId: 's1', questionIds: ['q1'], answers: { q1: 'B' }, startedAt: '', finishedAt: '', durationMinutes: 60, totalScore: 100, perQuestionScore: 100, score: 0 }
    const material = buildExamMaterial(state(), exam)
    const messages = buildWeaknessMessages(material, state())
    const serialized = JSON.stringify(messages)
    expect(material.text).toContain('结果：错误')
    expect(serialized).toContain('高等数学')
    expect(serialized).not.toContain('secret-key')
  })
})

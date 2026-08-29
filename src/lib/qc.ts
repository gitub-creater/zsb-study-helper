// 题库数据质量检查与重复检测
import type { Question, State } from '../types'

export interface QcIssue {
  qid: string
  rule: string
  detail: string
  level: 'error' | 'warn'
}

export interface DupGroup {
  key: string
  ids: string[]
}

function normStem(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

/** 数据质量自动检查(八条规则) */
export function qualityCheck(state: State): { issues: QcIssue[]; dupGroups: DupGroup[]; passed: number } {
  const issues: QcIssue[] = []
  const chapterIds = new Set(state.chapters.map((c) => c.id))
  const stemMap = new Map<string, string[]>() // 归一化题干 -> ids

  for (const q of state.questions) {
    const add = (rule: string, detail: string, level: 'error' | 'warn' = 'error') =>
      issues.push({ qid: q.id, rule, detail, level })

    if (!q.answer.trim()) add('缺少答案', '该题没有填写正确答案')
    if (!q.explanation.trim()) add('缺少解析', '解析为空,练习时无法讲解', 'warn')
    if (!q.chapterId || !chapterIds.has(q.chapterId)) add('章节无效', '所属章节不存在或已删除')
    if (q.year < 2025) add('年份过旧', `题目年份 ${q.year} 低于 2025`, 'warn')
    if (!q.source.trim()) add('缺少来源', '来源为空,无法追溯', 'warn')
    if (q.isReal && !q.sourceUrl) add('真题缺来源', '标记为真题但没有来源网址', 'error')
    if (q.qType === 'AI生成' && q.official) add('AI误标官方', 'AI 生成题不允许标记为官方真题')

    if (q.type === 'single' || q.type === 'multiple') {
      if (q.options.length < 2) add('选项不足', '选择题至少需要 2 个选项')
      const letters = q.answer.toUpperCase().replace(/[^A-H]/g, '')
      if (!letters) add('答案格式无效', '选择题答案应为字母')
      else if (letters.split('').some((l) => l.charCodeAt(0) - 65 >= q.options.length))
        add('答案超范围', `答案 ${letters} 超出选项数量`)
    }
    if (q.type === 'judge' && !['A', 'B'].includes(q.answer.toUpperCase()))
      add('判断答案无效', '判断题答案应为 A(正确) 或 B(错误)')

    const key = normStem(q.stem)
    if (key.length > 0) {
      const list = stemMap.get(key) ?? []
      list.push(q.id)
      stemMap.set(key, list)
    }
  }

  const dupGroups: DupGroup[] = []
  for (const [key, ids] of stemMap.entries()) {
    if (ids.length > 1) {
      dupGroups.push({ key, ids })
      for (const id of ids.slice(1)) {
        issues.push({ qid: id, rule: '重复题干', detail: `与题目 ${ids[0]} 题干高度相似`, level: 'warn' })
      }
    }
  }

  const passed = Math.max(0, state.questions.length - new Set(issues.map((i) => i.qid)).size)
  return { issues, dupGroups, passed }
}

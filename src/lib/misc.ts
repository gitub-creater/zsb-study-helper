import type { Question, QuestionType } from '../types'

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, x) => s + x, 0) / arr.length
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function normalizeText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

function lettersOf(s: string): string {
  return (s.toUpperCase().match(/[A-Z]/g) ?? []).sort().join('')
}

/** 判定用户答案是否正确(多选需完全一致,填空做归一化比较) */
export function checkAnswer(q: Pick<Question, 'type' | 'answer'>, user: string): boolean {
  if (q.type === 'fill') {
    const u = normalizeText(user)
    return u !== '' && u === normalizeText(q.answer)
  }
  if (q.type === 'multiple') {
    return lettersOf(user) === lettersOf(q.answer) && lettersOf(user).length > 0
  }
  return user.trim() !== '' && user.trim() === q.answer.trim()
}

/** 页面跳转(hash 路由) */
export function nav(to: string): void {
  window.location.hash = '#/' + to
}

export function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  downloadBlob(filename, blob)
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const LETTERS = 'ABCDEFGH'.split('')

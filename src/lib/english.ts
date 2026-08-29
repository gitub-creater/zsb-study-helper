import type { State } from '../types'

export interface EngWord {
  word: string
  phon: string
  pos: string
  cn: string
  ex: string
  ext: string
  unit: number
}

export interface EngBank {
  meta: { name: string; version: number; updatedAt: string }
  words: EngWord[]
}

let cache: Promise<EngBank> | null = null

export function loadEnglishWords(): Promise<EngBank> {
  if (cache) return cache
  cache = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/english-words.json`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as EngBank
        if (Array.isArray(data.words)) return data
      }
    } catch {
      // ignore
    }
    return { meta: { name: '空', version: 0, updatedAt: '' }, words: [] }
  })()
  return cache
}

/** 计算连续打卡天数(截止今天;若今天未打卡,则看昨天是否连续) */
export function computeStreak(checkedDates: string[], today: string): number {
  if (checkedDates.length === 0) return 0
  const set = new Set(checkedDates)
  let day = today
  if (!set.has(day)) {
    const d = new Date(today)
    d.setDate(d.getDate() - 1)
    day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!set.has(day)) return 0
  }
  let streak = 0
  while (set.has(day)) {
    streak++
    const d = new Date(day)
    d.setDate(d.getDate() - 1)
    day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return streak
}

/** 今日应学单元(1 起):已完成打卡的天数 + 1 */
export function currentUnit(checkedDates: string[], today: string): number {
  return checkedDates.filter((d) => d <= today).length + 1
}

export function wordsOfUnit(words: EngWord[], unit: number): EngWord[] {
  return words.filter((w) => w.unit === unit)
}

export function totalUnits(words: EngWord[]): number {
  return words.reduce((m, w) => Math.max(m, w.unit), 0)
}

export function englishStats(state: State, today: string) {
  const checked = state.english?.checkedDates ?? []
  return {
    streak: computeStreak(checked, today),
    totalChecked: checked.length,
    todayChecked: checked.includes(today),
    mastered: state.english?.mastered.length ?? 0,
  }
}

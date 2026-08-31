// 已安排任务(定时提醒)纯逻辑:发生时刻 key、下次执行计算、到期判定
// 全部使用本地时区;发生时刻以 "YYYY-MM-DDTHH:MM" 本地串表示(也是防重复 key)
import type { ScheduleTask } from '../types'
import { parseDate, todayStr } from './date'

export const MAX_HISTORY = 50
export const MAX_FIRED_KEYS = 120
export const SNOOZE_MINUTES = 5
const MAX_SEARCH_DAYS = 367

/** Date → "YYYY-MM-DDTHH:MM"(分钟精度) */
export function localStamp(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${todayStr(d)}T${hh}:${mm}`
}

/** "YYYY-MM-DDTHH:MM" → 本地 Date */
export function parseStamp(s: string): Date {
  const [date, time = '00:00'] = s.split('T')
  const [hh, mm] = time.split(':').map(Number)
  const d = parseDate(date)
  d.setHours(hh || 0, mm || 0, 0, 0)
  return d
}

/** 去掉秒与毫秒 */
export function minuteFloor(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())
}

/** 该发生时刻实际弹提醒的时间(含提前量) */
export function fireAt(stamp: string, remindBefore: number): Date {
  return new Date(parseStamp(stamp).getTime() - (remindBefore || 0) * 60000)
}

function minutesOf(time: string): { hh: number; mm: number } {
  const [hh, mm] = time.split(':').map(Number)
  return { hh: Number.isFinite(hh) ? hh : 9, mm: Number.isFinite(mm) ? mm : 0 }
}

function matchesDay(task: ScheduleTask, d: Date): boolean {
  const r = task.repeat
  if (r.kind === 'daily') return true
  if (r.kind === 'once') return todayStr(d) === task.date
  return r.weekdays.includes(d.getDay())
}

/**
 * 从 after 起(含/exclusive)找下一个符合重复规则与结束日期的发生时刻。
 * 找不到(超一年/超过结束日期/仅一次已过)返回 null。
 */
export function nextOccurrence(task: ScheduleTask, after: Date, exclusive = false): string | null {
  if (task.repeat.kind === 'weekly' && task.repeat.weekdays.length === 0) return null
  const { hh, mm } = minutesOf(task.time)
  const startDay = task.date > todayStr(after) ? task.date : todayStr(after)
  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    const d = parseDate(startDay)
    d.setDate(d.getDate() + i)
    if (task.repeat.kind !== 'once' && task.endDate && todayStr(d) > task.endDate) return null
    if (!matchesDay(task, d)) continue
    const occ = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm)
    const ok = exclusive ? occ.getTime() > after.getTime() : occ.getTime() >= after.getTime()
    if (ok) return localStamp(occ)
    if (task.repeat.kind === 'once') return null
  }
  return null
}

/** 按当前状态重算下次执行时刻(暂停/已结束 → null) */
export function withNextRun(task: ScheduleTask, now: Date): ScheduleTask {
  return { ...task, nextRunAt: task.enabled ? nextOccurrence(task, minuteFloor(now)) : null }
}

/** 是否已经到了该弹提醒的时间(且没有提醒过) */
export function isDue(task: ScheduleTask, now: Date): boolean {
  if (!task.enabled || !task.nextRunAt) return false
  if (task.firedKeys.includes(task.nextRunAt)) return false
  return now.getTime() >= fireAt(task.nextRunAt, task.remindBefore).getTime()
}

/** 重复规则的展示文案 */
export function repeatText(task: ScheduleTask): string {
  const r = task.repeat
  const end = task.endDate ? ` · 至 ${task.endDate.slice(5).replace('-', '/')}` : ''
  if (r.kind === 'once') return `仅一次 · ${task.date.slice(5).replace('-', '/')}`
  if (r.kind === 'daily') return `每天${end}`
  const names = ['日', '一', '二', '三', '四', '五', '六']
  const days = [...r.weekdays].sort((a, b) => a - b).map((w) => `周${names[w]}`)
  return `每周${days.join('、')}${end}`
}

/** 生成新任务(创建时调用) */
export function makeScheduleTask(input: Omit<ScheduleTask, 'createdAt' | 'updatedAt' | 'firedKeys' | 'history'>): ScheduleTask {
  const nowIso = new Date().toISOString()
  return {
    ...input,
    createdAt: nowIso,
    updatedAt: nowIso,
    firedKeys: [],
    history: [],
    ...(input.enabled ? { nextRunAt: nextOccurrence(input as ScheduleTask, minuteFloor(new Date())) } : { nextRunAt: null }),
  }
}

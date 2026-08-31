// 已安排任务(定时提醒)纯逻辑。发生时刻统一为北京时间墙上时间 YYYY-MM-DDTHH:MM，
// 该字符串同时作为防重复 key；不依赖设备当前时区，避免跨时区或夏令时造成任务漂移。
import type { ScheduleRepeat, ScheduleTask } from '../types'

export const SCHEDULE_TIMEZONE = 'Asia/Shanghai' as const
export const MAX_HISTORY = 50
export const MAX_FIRED_KEYS = 120
export const SNOOZE_MINUTES = 5
/**
 * 应用重新打开时，只补发很短时间内刚错过的提醒。
 * 超过这个窗口的重复任务会直接推进到下一次，避免离线多天后逐条补弹历史提醒。
 */
export const MISSED_REMINDER_GRACE_MINUTES = 5
const MAX_SEARCH_DAYS = 732

type BeijingParts = { date: string; time: string }

const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function formatBeijingParts(value: Date): BeijingParts {
  const parts = beijingFormatter.formatToParts(value)
  const at = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  // 少数运行时会把午夜表示成 24:00；任务时刻使用 00:00 才能稳定比较。
  const hour = at('hour') === '24' ? '00' : at('hour')
  return { date: `${at('year')}-${at('month')}-${at('day')}`, time: `${hour}:${at('minute')}` }
}

function dateParts(date: string): [number, number, number] {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!matched) return [1970, 1, 1]
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])]
}

/** 日历日期加减，不经过设备本地时区。 */
export function addScheduleDays(date: string, days: number): string {
  const [year, month, day] = dateParts(date)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

function weekdayOfScheduleDate(date: string): number {
  const [year, month, day] = dateParts(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function calendarDaysBetween(start: string, end: string): number {
  const [startYear, startMonth, startDay] = dateParts(start)
  const [endYear, endMonth, endDay] = dateParts(end)
  return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000)
}

function minutesOf(time: string): { hh: string; mm: string } {
  const matched = /^(\d{1,2}):(\d{1,2})$/.exec(time)
  const hour = matched ? Math.min(23, Math.max(0, Number(matched[1]))) : 9
  const minute = matched ? Math.min(59, Math.max(0, Number(matched[2]))) : 0
  return { hh: String(hour).padStart(2, '0'), mm: String(minute).padStart(2, '0') }
}

function timeOfTask(task: ScheduleTask): string {
  const { hh, mm } = minutesOf(task.time || task.remindAt?.slice(11, 16) || '09:00')
  return `${hh}:${mm}`
}

/** 兼容旧字段与 TaskReminder 字段；新代码始终以此读取重复规则。 */
export function scheduleRepeat(task: ScheduleTask): ScheduleRepeat {
  return task.repeatRule ?? task.repeat
}

/** 兼容旧任务的名称与内容字段。 */
export function scheduleTitle(task: ScheduleTask): string {
  return task.title?.trim() || task.name || '未命名任务'
}

export function scheduleContent(task: ScheduleTask): string {
  return task.content ?? task.note ?? ''
}

export function scheduleAdvanceMinutes(task: ScheduleTask): number {
  const raw = task.advanceMinutes ?? task.remindBefore ?? 0
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
}

/** 旧任务默认不突然发声；新建任务由表单明确写入 true。 */
export function scheduleVoiceEnabled(task: ScheduleTask): boolean {
  // 用户显式关闭优先于旧版 reminderSound 字段，避免编辑旧任务后仍被意外播报。
  if (task.voiceEnabled === false) return false
  return task.voiceEnabled === true || task.reminderSound === 'voice'
}

export function scheduleNotificationEnabled(task: ScheduleTask): boolean {
  return task.notificationEnabled !== false
}

export function scheduleReminderSound(task: ScheduleTask): 'voice' | 'chime' | 'silent' {
  if (task.reminderSound === 'voice' || task.reminderSound === 'chime' || task.reminderSound === 'silent') return task.reminderSound
  return task.voiceEnabled ? 'voice' : 'silent'
}

/** Date → 北京时间 "YYYY-MM-DDTHH:MM"（保留旧函数名，避免调用方迁移）。 */
export function localStamp(value: Date): string {
  const { date, time } = formatBeijingParts(value)
  return `${date}T${time}`
}

export function beijingTodayStr(value = new Date()): string {
  return formatBeijingParts(value).date
}

/** "YYYY-MM-DDTHH:MM"（北京时间墙上时刻）→ 绝对 Date。 */
export function parseStamp(stamp: string): Date {
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(stamp)
  if (!matched) return new Date(Number.NaN)
  return new Date(`${matched[1]}T${matched[2]}:${matched[3] ?? '00'}+08:00`)
}

/** 去掉秒与毫秒，保持绝对时刻不变。 */
export function minuteFloor(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 60000) * 60000)
}

/** 该发生时刻实际弹提醒的绝对时间（含提前量）。 */
export function fireAt(stamp: string, remindBefore: number): Date {
  return new Date(parseStamp(stamp).getTime() - Math.max(0, remindBefore || 0) * 60000)
}

function matchesDay(task: ScheduleTask, date: string): boolean {
  const repeat = scheduleRepeat(task)
  if (repeat.kind === 'once') return date === task.date
  if (date < task.date) return false
  if (repeat.kind === 'daily') return true
  if (repeat.kind === 'weekly') return repeat.weekdays.includes(weekdayOfScheduleDate(date))
  const intervalDays = Number.isFinite(repeat.intervalDays) ? Math.max(1, Math.floor(repeat.intervalDays)) : 1
  return calendarDaysBetween(task.date, date) % intervalDays === 0
}

/**
 * 从 after 起（含/exclusive）找下一个符合重复规则与结束日期的发生时刻。
 * 找不到（超过范围、结束日期或仅一次已过）时返回 null。
 */
export function nextOccurrence(task: ScheduleTask, after: Date, exclusive = false): string | null {
  const repeat = scheduleRepeat(task)
  if (repeat.kind === 'weekly' && repeat.weekdays.length === 0) return null
  const afterStamp = localStamp(after)
  const afterDate = afterStamp.slice(0, 10)
  const startDate = task.date > afterDate ? task.date : afterDate
  const time = timeOfTask(task)

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset++) {
    const date = addScheduleDays(startDate, dayOffset)
    if (repeat.kind !== 'once' && task.endDate && date > task.endDate) return null
    if (!matchesDay(task, date)) continue
    const occurrence = `${date}T${time}`
    const occurrenceAt = parseStamp(occurrence).getTime()
    const afterAt = after.getTime()
    if (exclusive ? occurrenceAt > afterAt : occurrenceAt >= afterAt) return occurrence
    if (repeat.kind === 'once') return null
  }
  return null
}

/** 补齐旧任务的兼容字段；不丢弃原有 name/note/repeat 等数据。 */
export function normalizeScheduleTask(task: ScheduleTask): ScheduleTask {
  const title = scheduleTitle(task)
  const content = scheduleContent(task)
  const repeat = scheduleRepeat(task)
  const advanceMinutes = scheduleAdvanceMinutes(task)
  const reminderSound = scheduleReminderSound(task)
  const voiceEnabled = task.voiceEnabled === true
  // enabled 是用户当前的开关；completed 仅是上一次计算得出的状态，不能阻止用户编辑后重新安排。
  const enabled = task.enabled
  const status = enabled ? (task.nextRunAt ? 'active' : task.status === 'completed' ? 'completed' : 'active') : task.status === 'completed' ? 'completed' : 'paused'
  return {
    ...task,
    name: title,
    note: content,
    time: timeOfTask(task),
    repeat,
    timezone: SCHEDULE_TIMEZONE,
    title,
    content,
    remindAt: `${task.date}T${timeOfTask(task)}`,
    repeatRule: repeat,
    advanceMinutes,
    voiceEnabled,
    notificationEnabled: task.notificationEnabled !== false,
    reminderSound,
    status,
    remindBefore: advanceMinutes,
  }
}

/** 按当前状态重算下次执行时刻（暂停/已结束 → null）。 */
export function withNextRun(task: ScheduleTask, now: Date): ScheduleTask {
  const normalized = normalizeScheduleTask(task)
  const nextRunAt = normalized.enabled ? nextOccurrence(normalized, minuteFloor(now)) : null
  return { ...normalized, nextRunAt, status: normalized.enabled ? (nextRunAt ? 'active' : 'completed') : normalized.status }
}

/** 是否已经到了该弹提醒的时间（且没有提醒过）。 */
export function isDue(task: ScheduleTask, now: Date): boolean {
  if (!task.enabled || !task.nextRunAt) return false
  if (task.firedKeys.includes(task.nextRunAt)) return false
  return now.getTime() >= fireAt(task.nextRunAt, scheduleAdvanceMinutes(task)).getTime()
}

/** 是否已错过常规提醒窗口，需要跳到未来的下一次发生时刻。 */
export function hasStaleScheduleOccurrence(task: ScheduleTask, now: Date): boolean {
  if (!task.enabled || !task.nextRunAt || task.snoozed) return false
  const latestUsefulAt = fireAt(task.nextRunAt, scheduleAdvanceMinutes(task)).getTime()
    + MISSED_REMINDER_GRACE_MINUTES * 60000
  return now.getTime() > latestUsefulAt
}

/**
 * 丢弃过期 occurrence，并按提前提醒量寻找真正仍在未来的下一次。
 * 不能只调用 withNextRun：当任务有提前提醒时，发生时刻可能尚未过去，但提醒时刻已过去。
 */
export function skipStaleScheduleOccurrence(task: ScheduleTask, now: Date): ScheduleTask {
  const normalized = normalizeScheduleTask(task)
  const threshold = new Date(now.getTime() + scheduleAdvanceMinutes(normalized) * 60000)
  const nextRunAt = normalized.enabled ? nextOccurrence(normalized, threshold) : null
  return {
    ...normalized,
    nextRunAt,
    status: normalized.enabled ? (nextRunAt ? 'active' : 'completed') : normalized.status,
  }
}

/** 重复规则的展示文案。 */
export function repeatText(task: ScheduleTask): string {
  const repeat = scheduleRepeat(task)
  const end = task.endDate ? ` · 至 ${task.endDate.slice(5).replace('-', '/')}` : ''
  if (repeat.kind === 'once') return `仅一次 · ${task.date.slice(5).replace('-', '/')}`
  if (repeat.kind === 'daily') return `每天${end}`
  if (repeat.kind === 'custom') return `每 ${Math.max(1, Math.floor(repeat.intervalDays || 1))} 天${end}`
  const names = ['日', '一', '二', '三', '四', '五', '六']
  const days = [...repeat.weekdays].sort((a, b) => a - b).map((weekday) => `周${names[weekday]}`)
  return `每周${days.join('、')}${end}`
}

/** 生成新任务（创建时调用）。 */
export function makeScheduleTask(input: Omit<ScheduleTask, 'createdAt' | 'updatedAt' | 'firedKeys' | 'history'>): ScheduleTask {
  const nowIso = new Date().toISOString()
  const task = normalizeScheduleTask({
    ...input,
    createdAt: nowIso,
    updatedAt: nowIso,
    firedKeys: [],
    history: [],
    // 新任务由创建界面明确设置；为没有该字段的调用保留安静的默认值。
    voiceEnabled: input.voiceEnabled ?? false,
    notificationEnabled: input.notificationEnabled ?? true,
    reminderSound: input.reminderSound ?? (input.voiceEnabled ? 'voice' : 'silent'),
  })
  return {
    ...task,
    nextRunAt: task.enabled ? nextOccurrence(task, minuteFloor(new Date())) : null,
  }
}

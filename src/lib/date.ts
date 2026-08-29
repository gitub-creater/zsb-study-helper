// 日期工具:全部使用本地时区的 YYYY-MM-DD 字符串

export function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return todayStr(d)
}

/** b - a 的天数差(按日历日) */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}

export function weekdayCn(s: string): string {
  return '周' + '日一二三四五六'.charAt(parseDate(s).getDay())
}

export function fmtDate(s: string): string {
  const d = parseDate(s)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 1) return '不到 1 分钟'
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${String(m % 60).padStart(2, '0')} 分`
}

export function clockFmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

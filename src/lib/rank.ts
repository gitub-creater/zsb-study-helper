// 每日学习排名:统计本机各账号今天的学习数据(数据仅存本机,不出设备)
import { dataKey, getSession, listUsers } from './auth'
import { todayStr } from './date'

export interface RankRow {
  userId: string
  name: string
  questions: number
  minutes: number
  xpToday: number
  score: number
  isMe: boolean
}

export function getTodayRanking(): RankRow[] {
  const today = todayStr()
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const me = getSession()?.userId
  const rows: RankRow[] = []
  for (const u of listUsers()) {
    try {
      const raw = localStorage.getItem(dataKey(u.id))
      if (!raw) continue
      const s = JSON.parse(raw) as {
        onboarded?: boolean
        attempts?: { date: string }[]
        studyTime?: Record<string, number>
        xpLog?: { t: number; amount: number }[]
      }
      if (!s.onboarded) continue
      const questions = (s.attempts ?? []).filter((a) => a.date === today).length
      const minutes = Math.round((s.studyTime?.[today] ?? 0) / 60)
      const xpToday = (s.xpLog ?? [])
        .filter((l) => l.t >= startToday.getTime())
        .reduce((sum, l) => sum + l.amount, 0)
      rows.push({
        userId: u.id,
        name: u.name,
        questions,
        minutes,
        xpToday,
        score: questions * 100 + minutes * 3 + xpToday,
        isMe: u.id === me,
      })
    } catch {
      // 某个账号数据损坏时跳过,不影响整体
    }
  }
  return rows.sort((a, b) => b.score - a.score)
}

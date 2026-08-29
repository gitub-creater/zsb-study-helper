// 山东专升本院校与专业参考库(与代码分离,存于 public/data/colleges.json)
import type { ExamCategory } from '../types'

export interface College {
  name: string
  city?: string
  nature: '公办' | '民办' | '独立学院'
}

export interface Major {
  name: string
  gate: string
  category: ExamCategory
}

export interface CollegeData {
  meta: { name: string; version: number; updatedAt: string; note?: string }
  colleges: College[]
  majors: Major[]
}

const EMPTY: CollegeData = { meta: { name: '空', version: 0, updatedAt: '' }, colleges: [], majors: [] }

let cache: Promise<CollegeData> | null = null

export function loadColleges(): Promise<CollegeData> {
  if (cache) return cache
  cache = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/colleges.json`)
      if (res.ok) {
        const data = (await res.json()) as CollegeData
        if (Array.isArray(data.colleges) && Array.isArray(data.majors)) return data
      }
    } catch {
      // 断网或文件缺失时走空数据,页面会提示
    }
    return EMPTY
  })()
  return cache
}

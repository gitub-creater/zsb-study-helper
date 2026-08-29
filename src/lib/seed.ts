// 种子/内容包加载:题库与大纲均存放于 public/data/,与代码分离
import type { CatalogData, SeedData } from '../types'

/** 当前内容包版本;更新 catalog 数据后递增即可触发合并 */
export const CATALOG_VERSION = 8

export const FALLBACK_SEED: SeedData = {
  meta: { name: '最小内置数据', version: 1, note: '未能加载示例题库,可稍后手动添加' },
  subjects: [
    { id: 's1', name: '大学英语', color: '#3E9BFF', targetScore: 80, order: 0 },
    { id: 's2', name: '高等数学', color: '#8B72E8', targetScore: 60, order: 1 },
  ],
  chapters: [
    { id: 'c11', subjectId: 's1', name: '词汇与语法', order: 0 },
    { id: 'c21', subjectId: 's2', name: '函数与极限', order: 0 },
  ],
  kps: [
    { id: 'k111', subjectId: 's1', chapterId: 'c11', name: '核心词汇', order: 0 },
    { id: 'k112', subjectId: 's1', chapterId: 'c11', name: '时态', order: 1 },
    { id: 'k211', subjectId: 's2', chapterId: 'c21', name: '函数定义域', order: 0 },
    { id: 'k212', subjectId: 's2', chapterId: 'c21', name: '极限', order: 1 },
  ],
  questions: [],
}

export async function loadSeed(): Promise<SeedData> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/seed.json`)
    if (res.ok) {
      const data = (await res.json()) as SeedData
      if (Array.isArray(data.subjects) && Array.isArray(data.kps)) return data
    }
  } catch {
    // 忽略,走回退
  }
  return FALLBACK_SEED
}

const EMPTY_CATALOG: CatalogData = {
  meta: { name: '空内容包', version: CATALOG_VERSION, updatedAt: '' },
  subjects: [],
  chapters: [],
  kps: [],
  questions: [],
}

let catalogPromise: Promise<CatalogData> | null = null

/** 加载考试类别内容包(语文/高数Ⅰ/Ⅱ/Ⅲ/政治/英语扩展/计算机扩展),失败返回空包 */
export function loadCatalog(): Promise<CatalogData> {
  if (catalogPromise) return catalogPromise
  catalogPromise = (async () => {
    try {
      // cache: 'no-store' 强制绕过 HTTP 缓存,确保内容包更新后一定拿到最新文件
      const [catRes, qRes] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/catalog.json?v=${CATALOG_VERSION}`, { cache: 'no-store' }),
        fetch(`${import.meta.env.BASE_URL}data/catalog-questions.json?v=${CATALOG_VERSION}`, { cache: 'no-store' }),
      ])
      if (!catRes.ok) return EMPTY_CATALOG
      const cat = (await catRes.json()) as CatalogData
      if (qRes.ok) {
        const q = (await qRes.json()) as { questions: NonNullable<CatalogData['questions']> }
        cat.questions = [...(cat.questions ?? []), ...(q.questions ?? [])]
      }
      if (!Array.isArray(cat.subjects) || !Array.isArray(cat.kps)) return EMPTY_CATALOG
      return cat
    } catch {
      return EMPTY_CATALOG
    }
  })()
  return catalogPromise
}

/** 从远程更新源拉取内容包(失败返回 null,不影响本地功能) */
export async function fetchRemoteCatalog(url: string): Promise<CatalogData | null> {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as CatalogData
    if (!Array.isArray(data.subjects) || !Array.isArray(data.kps)) return null
    return data
  } catch {
    return null
  }
}

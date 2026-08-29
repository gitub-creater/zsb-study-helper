// 联网热门题搜索接口(第三阶段接入)
// 约束:只抓取公开、允许访问的内容;遵守来源网站规则;不绕过登录/验证码/付费墙
export interface HotQuestionItem {
  id: string
  stem: string
  sourceName: string
  sourceUrl: string
  publishDate: string
  fetchedAt: string
  materialType:
    | '官方发布'
    | '官方样题'
    | '机构模拟题'
    | '普通练习题'
    | '考生回忆题'
    | '网络讨论题'
    | 'AI生成题'
  verified: boolean
  outlineMatch: string
  hotScore: number
  hotReasons: string[]
  answerConflict?: { answer: string; source: string }[]
}

export interface SearchProvider {
  id: string
  search(query: { year?: number; subject?: string; days?: 30 | 90 | 365 }): Promise<HotQuestionItem[]>
}

export const searchProvider: SearchProvider | null = null

// Supabase 客户端(前端,可发布密钥):环境变量缺失时返回 null,功能自动回退本地驱动
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null
  if (!client) {
    try {
      client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        // 会议白板高频增量(擦除点/笔迹)需要更高吞吐,20 会导致事件被节流堆积成"延迟"
        realtime: { params: { eventsPerSecond: 60 } },
      })
    } catch {
      return null
    }
  }
  return client
}

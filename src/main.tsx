import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import './styles/global.css'
import { SupabaseRealtimeDriver } from './services/rtc'
import { communityCloudDriver, communityCloudConfigured } from './services/communityCloud'

// 全局驱动注入:仅当构建时包含 Supabase 环境变量才走云端(跨设备);
// 否则不注入,rtc/community 内部自动回退本机 BroadcastChannel,功能完整不报错。
if (communityCloudConfigured) {
  ;(globalThis as Record<string, unknown>).rtcDriver = () => new SupabaseRealtimeDriver()
  ;(globalThis as Record<string, unknown>).communityDriver = communityCloudDriver
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

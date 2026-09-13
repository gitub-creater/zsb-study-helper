import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import './styles/global.css'
import { createDefaultDriver } from './services/rtc'
import { communityCloudDriver, communityCloudConfigured } from './services/communityCloud'

// 全局驱动注入:驱动工厂自动选择通道——
//   ① 配置了 VITE_RTC_WS_URL → 自建 WebSocket 信令(钉钉级实时)
//   ② 否则配置了 Supabase 环境变量 → Supabase Realtime(跨设备云端)
//   ③ 都没有 → 本机 BroadcastChannel
// 社区云同步(好友/私信跨设备)仍独立走 Supabase。
;(globalThis as Record<string, unknown>).rtcDriver = () => createDefaultDriver()
if (communityCloudConfigured) {
  ;(globalThis as Record<string, unknown>).communityDriver = communityCloudDriver
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

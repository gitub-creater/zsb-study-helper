import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import './styles/global.css'
import { SupabaseRealtimeDriver } from './services/rtc'
import { communityCloudDriver } from './services/communityCloud'

// 全局驱动注入:有 Supabase 环境变量时走云端(跨设备),否则 rtc 内部自动回退本机 BroadcastChannel
;(globalThis as Record<string, unknown>).rtcDriver = () => new SupabaseRealtimeDriver()
;(globalThis as Record<string, unknown>).communityDriver = communityCloudDriver

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

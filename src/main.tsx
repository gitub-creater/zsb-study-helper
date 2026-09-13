import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import './styles/global.css'
import { communityCloudDriver, communityCloudConfigured } from './services/communityCloud'

// 会议通道由 createDefaultDriver() 自动选择(自建信令 → Supabase → 本机),
// 这里不再注入 rtcDriver——注入同一个工厂会造成自引用递归(栈溢出)。
// 社区云同步(好友/私信跨设备)仍独立走 Supabase。
if (communityCloudConfigured) {
  ;(globalThis as Record<string, unknown>).communityDriver = communityCloudDriver
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

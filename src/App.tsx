// 应用壳:路由 / 侧边导航(电脑) / 底部导航(手机) / 主题 / 错误边界
import React, { useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useStore } from './store/store'
import { StoreProvider } from './store/store'
import { ToastProvider, Modal } from './components/ui'
import { Icon } from './components/Icon'
import type { IconName } from './components/Icon'
import { Mascot } from './components/Mascot'
import { Avatar } from './components/Avatar'
import { Onboarding } from './pages/Onboarding'
import { Today } from './pages/Today'
import { Bank } from './pages/Bank'
import { Practice } from './pages/Practice'
import { WrongBook } from './pages/WrongBook'
import { PlanPage } from './pages/PlanPage'
import { MapPage } from './pages/MapPage'
import { StatsPage } from './pages/StatsPage'
import { ProfilePage } from './pages/ProfilePage'
import { SettingsPage } from './pages/SettingsPage'
import { HotPage } from './pages/HotPage'
import { SourcesPage } from './pages/SourcesPage'
import { RankWindow } from './pages/RankWindow'
import { OfficePage } from './pages/OfficePage'
import { EnglishPage } from './pages/EnglishPage'
import { AVATAR_INFO, applyTheme } from './lib/theme'
import { levelInfo } from './lib/xp'
import { nav } from './lib/misc'
import { clearSession, dataKey, getSession } from './lib/auth'
import { LoginGate } from './pages/LoginPage'
import { Splash } from './components/Splash'
import { InstallBanner } from './components/InstallBanner'

interface NavItem {
  key: string
  label: string
  icon: IconName
  phase?: number
}

const NAV: NavItem[] = [
  { key: 'today', label: '今日学习', icon: 'home' },
  { key: 'map', label: '知识校园', icon: 'map' },
  { key: 'bank', label: '题库', icon: 'book' },
  { key: 'office', label: '实操大题', icon: 'edit' },
  { key: 'english', label: '英语打卡', icon: 'mic' },
  { key: 'sources', label: '考试资料', icon: 'cap' },
  { key: 'hot', label: '热门题', icon: 'fire' },
  { key: 'wrong', label: '错题本', icon: 'wrongbook' },
  { key: 'plan', label: '学习计划', icon: 'calendar' },
  { key: 'stats', label: '数据分析', icon: 'chart' },
  { key: 'profile', label: '个人角色', icon: 'user' },
  { key: 'settings', label: '设置', icon: 'settings' },
]

const MOBILE_MAIN: NavItem[] = [NAV[0], NAV[2], NAV[4], NAV[5]]

const PAGE_TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.key, n.label]))

function useHashRoute(): string {
  const get = () => window.location.hash.replace(/^#\//, '') || 'today'
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const h = () => setRoute(get())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return route
}

function Sidebar({ route }: { route: string }) {
  const { state } = useStore()
  const level = levelInfo(state.xp)
  return (
    <aside className="sidebar">
      <div className="logo">
        <Mascot mood="idle" size={34} />
        <b>
          知识校园
          <span className="sub">山东专升本备考助手</span>
        </b>
      </div>
      <nav className="nav" aria-label="主导航">
        {NAV.map((n) => (
          <a key={n.key} href={`#/${n.key}`} className={route === n.key ? 'on' : ''}>
            <Icon name={n.icon} size={17} />
            {n.label}
            {n.phase && <span className="soon">{n.phase}期</span>}
          </a>
        ))}
      </nav>
      <div className="sidebar-foot">
        <a className="mini-profile" href="#/profile">
          {state.profile && <Avatar kind={state.profile.avatar} color={AVATAR_INFO[state.profile.avatar].color} size={34} />}
          <span className="who">
            <b>{state.profile?.nickname ?? '未设置'}</b>
            <span>
              Lv.{level.level} · {state.xp} 经验
            </span>
          </span>
        </a>
        <button
          className="btn btn-sm w100 mt8 btn-ghost"
          onClick={() => {
            clearSession()
            window.location.reload()
          }}
        >
          <Icon name="left" size={13} /> 退出登录
        </button>
      </div>
    </aside>
  )
}

function BottomNav({ route, onMore }: { route: string; onMore: () => void }) {
  const { state } = useStore()
  const dueCount = Object.values(state.wrong).filter((e) => !e.archived && e.nextReviewAt && e.nextReviewAt <= new Date().toISOString().slice(0, 10)).length
  return (
    <nav className="bottom-nav" aria-label="底部导航">
      {MOBILE_MAIN.map((n) => (
        <a key={n.key} href={`#/${n.key}`} className={route === n.key ? 'on' : ''}>
          <Icon name={n.icon} size={20} />
          {n.label}
          {n.key === 'wrong' && dueCount > 0 && (
            <span style={{ position: 'absolute', transform: 'translate(14px, -18px)' }} className="chip chip-red num" aria-label={`${dueCount} 道到期`}>
              {dueCount}
            </span>
          )}
        </a>
      ))}
      <button type="button" className={['map', 'hot', 'stats', 'profile', 'settings'].includes(route) ? 'on' : ''} onClick={onMore}>
        <Icon name="dots" size={20} />
        更多
      </button>
    </nav>
  )
}

function Shell({ route, children }: { route: string; children: ReactNode }) {
  const { state } = useStore()
  const [moreOpen, setMoreOpen] = useState(false)
  const level = levelInfo(state.xp)
  return (
    <div className="app">
      <Sidebar route={route} />
      <div className="main-col">
        <header className="topbar">
          <Mascot mood="idle" size={26} />
          <b>{PAGE_TITLES[route] ?? '今日学习'}</b>
          <div className="right">
            <span className="chip chip-yellow num">Lv.{level.level}</span>
            <a href="#/profile" aria-label="个人角色">
              {state.profile && <Avatar kind={state.profile.avatar} color={AVATAR_INFO[state.profile.avatar].color} size={30} />}
            </a>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
      <BottomNav route={route} onMore={() => setMoreOpen(true)} />
      <Modal open={moreOpen} title="更多功能" onClose={() => setMoreOpen(false)} width={360}>
        <div className="more-sheet-list">
          {NAV.filter((n) => !MOBILE_MAIN.some((m) => m.key === n.key) && n.key !== 'today').map((n) => (
            <a key={n.key} href={`#/${n.key}`} onClick={() => setMoreOpen(false)}>
              <Icon name={n.icon} size={18} />
              {n.label}
              {n.phase && <span className="chip" style={{ marginLeft: 'auto' }}>{n.phase} 期开放</span>}
            </a>
          ))}
        </div>
      </Modal>
    </div>
  )
}

class ErrorBoundary extends React.Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('页面错误:', err, info)
  }
  render() {
    if (this.state.err) {
      return (
        <div className="empty" style={{ paddingTop: 100 }}>
          <Mascot mood="think" size={84} />
          <h3>页面出了点小问题</h3>
          <p>{this.state.err.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function Router() {
  const { state } = useStore()
  const route = useHashRoute()

  useEffect(() => {
    applyTheme(state.profile?.theme ?? 'sky')
  }, [state.profile?.theme])

  useEffect(() => {
    document.body.classList.toggle('rm', state.settings.reduceMotion)
  }, [state.settings.reduceMotion])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route])

  if (!state.onboarded) return <Onboarding />

  // 独立排名窗口(从今日页"打开排名窗口"弹出,无侧边导航)
  if (route === 'rank') return <RankWindow />

  if (route === 'practice') return <Practice />

  const pages: Record<string, ReactNode> = {
    today: <Today />,
    map: <MapPage />,
    bank: <Bank />,
    office: <OfficePage />,
    english: <EnglishPage />,
    sources: <SourcesPage />,
    hot: <HotPage />,
    wrong: <WrongBook />,
    plan: <PlanPage />,
    stats: <StatsPage />,
    profile: <ProfilePage />,
    settings: <SettingsPage />,
  }

  return <Shell route={route}>{pages[route] ?? <Today />}</Shell>
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [session, setSession] = useState(() => getSession())

  if (!splashDone) {
    return <Splash onFinish={() => setSplashDone(true)} />
  }

  if (!session) {
    return (
      <ToastProvider>
        <LoginGate onSession={() => setSession(getSession())} />
      </ToastProvider>
    )
  }

  return (
    <ErrorBoundary>
      <StoreProvider key={session.userId} storageKey={dataKey(session.userId)}>
        <ToastProvider>
          <Router />
          <InstallBanner />
        </ToastProvider>
      </StoreProvider>
    </ErrorBoundary>
  )
}

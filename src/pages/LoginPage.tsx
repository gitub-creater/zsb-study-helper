import React, { useEffect, useState } from 'react'
import { Mascot } from '../components/Mascot'
import { Field, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { createUser, ensureLegacyMigrated, findUserByName, listUsers, migrateUserId, setCloudRegistrationPending, setEmail, setPassword as setStoredPassword, setSession, verifyPassword } from '../lib/auth'
import type { AuthUser } from '../lib/auth'
import { getCloudApiUrl, loginCloud, registerCloud, resetCloudPassword, saveCloudApiUrl, sendVerificationCode } from '../services/cloud'

type AuthTab = 'login' | 'register' | 'forgot'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i

export function LoginGate({ onSession }: { onSession: () => void }) {
  const toast = useToast()
  const [users, setUsers] = useState<AuthUser[]>([])
  const [tab, setTab] = useState<AuthTab>('login')
  const [busy, setBusy] = useState(false)
  const [cloudApiUrl, setCloudApiUrl] = useState(() => getCloudApiUrl() ?? '')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmailValue] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const refresh = () => setUsers(listUsers())

  useEffect(() => {
    ensureLegacyMigrated()
    refresh()
  }, [])

  const enter = (user: AuthUser, cloud: { token: string; apiUrl: string }) => {
    setSession({ userId: user.id, name: user.name, cloudToken: cloud.token, cloudApiUrl: cloud.apiUrl })
    onSession()
  }

  const resetCode = () => {
    setCode('')
    setCountdown(0)
  }

  const switchTab = (next: AuthTab) => {
    setTab(next)
    resetCode()
    setPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const sendCode = async () => {
    const normalized = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) {
      toast('请输入正确的邮箱地址', { kind: 'error' })
      return
    }
    if (cloudApiUrl.trim()) saveCloudApiUrl(cloudApiUrl)
    setBusy(true)
    try {
      const purpose = tab === 'register' ? 'register' : tab === 'forgot' ? 'reset_password' : 'login'
      const result = await sendVerificationCode(normalized, purpose)
      if (result.kind === 'ok') {
        setCountdown(60)
        const iv = window.setInterval(() => setCountdown((value) => (value <= 1 ? (window.clearInterval(iv), 0) : value - 1)), 1000)
        toast('验证码已发送，请查收邮箱', { kind: 'success', duration: 5000 })
      } else if (result.kind === 'rate_limited') {
        toast(`发送过于频繁，请 ${result.waitSeconds} 秒后再试`, { kind: 'error' })
      } else {
        toast(result.message, { kind: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = async () => {
    if (!account.trim() || !password || !EMAIL_RE.test(email.trim()) || !/^\d{6}$/.test(code)) {
      toast('账号、密码、邮箱和 6 位验证码都不能为空', { kind: 'error' })
      return
    }
    setBusy(true)
    try {
      if (cloudApiUrl.trim()) saveCloudApiUrl(cloudApiUrl)
      const result = await loginCloud(account, password, email, code)
      if (result.kind !== 'ok') {
        toast(result.kind === 'bad_password' ? '密码不正确' : result.kind === 'not_found' ? '账号不存在' : result.kind === 'unavailable' ? '云端暂时不可用，请稍后重试' : result.message, { kind: 'error' })
        return
      }
      let local = users.find((user) => user.id === result.user.id) ?? findUserByName(result.user.name)
      if (local && local.id !== result.user.id) {
        if (!(await verifyPassword(local.id, password))) {
          toast('本机同名账号的密码不一致，已拒绝自动合并', { kind: 'error' })
          return
        }
        local = migrateUserId(local.id, result.user.id)
      }
      if (!local) local = await createUser(result.user.name, password, result.user.id, email)
      else {
        if (!local.email) setEmail(local.id, email)
        if (!local.hash || !(await verifyPassword(local.id, password))) await setStoredPassword(local.id, password)
      }
      setCloudRegistrationPending(local.id, false)
      refresh()
      enter(local, result.session)
    } catch (error) {
      toast(error instanceof Error ? error.message : '登录失败', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const submitRegister = async () => {
    if (account.trim().length < 2 || password.length < 4 || !EMAIL_RE.test(email.trim()) || !/^\d{6}$/.test(code)) {
      toast('账号、密码、邮箱和 6 位验证码都必须填写正确', { kind: 'error' })
      return
    }
    if (findUserByName(account)) {
      toast('本机已有同名账号，请直接登录', { kind: 'error' })
      return
    }
    setBusy(true)
    try {
      if (cloudApiUrl.trim()) saveCloudApiUrl(cloudApiUrl)
      const id = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      const result = await registerCloud(id, account, password, email, code, true)
      if (result.kind !== 'ok') {
        const message = result.kind === 'unavailable'
          ? '云端暂时不可用，请稍后重试'
          : result.kind === 'not_found'
            ? '账号不存在'
            : result.kind === 'bad_password'
              ? '密码不正确'
              : result.message
        toast(message, { kind: 'error' })
        return
      }
      const local = await createUser(account, password, result.user.id, email)
      setCloudRegistrationPending(local.id, false)
      refresh()
      toast('账号注册成功', { kind: 'success' })
      enter(local, result.session)
    } catch (error) {
      toast(error instanceof Error ? error.message : '注册失败', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async () => {
    if (!EMAIL_RE.test(email.trim()) || !/^\d{6}$/.test(code) || newPassword.length < 4 || newPassword !== confirmPassword) {
      toast('请填写正确的邮箱、验证码和两次一致的新密码', { kind: 'error' })
      return
    }
    setBusy(true)
    try {
      const result = await resetCloudPassword(email, code, newPassword, confirmPassword)
      if (result.kind !== 'ok') {
        toast(result.message, { kind: 'error' })
        return
      }
      const local = users.find((user) => user.email?.toLowerCase() === email.trim().toLowerCase())
      if (local) {
        await setStoredPassword(local.id, newPassword)
      }
      toast('密码已重置，请使用新密码登录', { kind: 'success' })
      switchTab('login')
    } catch (error) {
      toast(error instanceof Error ? error.message : '重置密码失败', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const codeRow = (
    <div className="row" style={{ gap: 8 }}>
      <input className="input grow" value={code} maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="粘贴 6 位验证码" />
      <button className="btn" style={{ minWidth: 120 }} disabled={busy || countdown > 0 || !email.trim()} onClick={sendCode}>
        {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
      </button>
    </div>
  )

  return (
    <div className="onboard">
      <div className="onboard-card" style={{ maxWidth: 460 }}>
        <div className="row" style={{ gap: 12 }}>
          <Mascot mood="idle" size={58} />
          <div>
            <h2 style={{ fontSize: 18 }}>专升本学习助手</h2>
            <p className="muted fs13">账号、密码和邮箱验证码齐全后才能进入</p>
          </div>
        </div>

        <div className="mt12 mb12">
          <Segmented value={tab} onChange={switchTab} options={[{ value: 'login', label: '登录' }, { value: 'register', label: '注册账号' }, { value: 'forgot', label: '忘记密码' }]} />
        </div>

        <div className="col" style={{ gap: 8 }}>
          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
            <Field label="云端地址">
              <input className="input" value={cloudApiUrl} onChange={(event) => setCloudApiUrl(event.target.value)} placeholder="https://your-domain.com" />
            </Field>
          )}

          {tab !== 'forgot' && (
            <Field label="账号">
              <input className="input" value={account} maxLength={12} onChange={(event) => setAccount(event.target.value)} placeholder="输入账号" />
            </Field>
          )}
          <Field label="邮箱">
            <input className="input" type="email" value={email} onChange={(event) => setEmailValue(event.target.value)} placeholder="输入绑定邮箱" />
          </Field>
          {tab !== 'forgot' && (
            <Field label="密码">
              <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" />
            </Field>
          )}
          {tab === 'forgot' && (
            <>
              <Field label="新密码">
                <input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 4 位" />
              </Field>
              <Field label="确认新密码">
                <input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" />
              </Field>
            </>
          )}
          <Field label="邮箱验证码">
            {codeRow}
          </Field>

          <button className="btn btn-primary" disabled={busy} onClick={tab === 'login' ? submitLogin : tab === 'register' ? submitRegister : submitReset}>
            {busy ? '处理中...' : tab === 'login' ? '登录' : tab === 'register' ? '创建账号' : '重置密码'}
          </button>

          {tab === 'login' && users.length > 0 && (
            <div className="col mt8" style={{ gap: 6 }}>
              <p className="fs13 muted">本机已保存账号（点击仅填入账号）</p>
              {users.filter((user) => !user.guest).map((user) => (
                <button key={user.id} className="btn" onClick={() => { setAccount(user.name); setEmailValue(user.email ?? '') }}>
                  <Icon name="user" size={14} /> {user.name}
                </button>
              ))}
            </div>
          )}

          <p className="fs13 muted mt8">验证码 10 分钟内有效；退出账号后再次登录仍需重新验证邮箱。</p>
        </div>
      </div>
    </div>
  )
}

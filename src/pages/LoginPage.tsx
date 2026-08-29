// 登录页:快速进入 / 本地账号注册登录 / 扫码登录(诚实占位:需开放平台资质)/ 忘记密码(手机号+验证码)
import React, { useEffect, useState } from 'react'
import { Mascot } from '../components/Mascot'
import { Field, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import {
  checkCode, createUser, ensureLegacyMigrated, findByPhone, issueCode, listUsers,
  setSession, setPassword, verifyPassword,
} from '../lib/auth'
import type { AuthUser } from '../lib/auth'

export function LoginGate({ onSession }: { onSession: () => void }) {
  const toast = useToast()
  const [users, setUsers] = useState<AuthUser[]>([])
  const [tab, setTab] = useState<'quick' | 'register' | 'forgot' | 'scan'>('quick')
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [regPw, setRegPw] = useState('')
  const [busy, setBusy] = useState(false)
  // 忘记密码
  const [fpPhone, setFpPhone] = useState('')
  const [fpCode, setFpCode] = useState('')
  const [fpSent, setFpSent] = useState('')
  const [fpPw, setFpPw] = useState('')
  const [fpCountdown, setFpCountdown] = useState(0)

  const refresh = () => setUsers(listUsers())
  useEffect(() => {
    ensureLegacyMigrated()
    refresh()
  }, [])

  const enter = (u: AuthUser) => {
    setSession({ userId: u.id, name: u.name })
    onSession()
  }

  const quickEnter = async (u: AuthUser) => {
    if (u.salt && u.hash) {
      setPwFor(u.id)
      setPw('')
      return
    }
    enter(u)
  }

  const submitPw = async () => {
    if (!pwFor) return
    setBusy(true)
    try {
      if (await verifyPassword(pwFor, pw)) {
        const u = users.find((x) => x.id === pwFor)!
        enter(u)
      } else {
        toast('密码不正确', { kind: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    if (name.trim().length < 2) {
      toast('昵称至少 2 个字符', { kind: 'error' })
      return
    }
    if (regPw.length < 4) {
      toast('密码至少 4 位', { kind: 'error' })
      return
    }
    setBusy(true)
    try {
      const u = await createUser(name, regPw)
      toast(`账号「${u.name}」创建成功`, { kind: 'success' })
      enter(u)
    } catch (e) {
      toast(e instanceof Error ? e.message : '创建失败', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboard">
      <div className="onboard-card" style={{ maxWidth: 460 }}>
        <div className="row" style={{ gap: 12 }}>
          <Mascot mood="idle" size={58} />
          <div>
            <h2 style={{ fontSize: 18 }}>专升本学习助手</h2>
            <p className="muted fs13">知识校园 · 数据保存在本机,按账号隔离</p>
          </div>
        </div>

        <div className="mt12 mb12">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'quick', label: '进入' },
              { value: 'register', label: '注册账号' },
              { value: 'forgot', label: '忘记密码' },
              { value: 'scan', label: '扫码登录' },
            ]}
          />
        </div>

        {tab === 'forgot' && (
          <div className="col">
            <p className="fs12 muted mb8">通过绑定的手机号找回;找回后原密码作废,请牢记新密码。</p>
            <Field label="绑定过的手机号">
              <input className="input" value={fpPhone} maxLength={11} onChange={(e) => setFpPhone(e.target.value)} placeholder="11 位手机号" />
            </Field>
            <div className="row">
              <input className="input grow" value={fpCode} maxLength={6} onChange={(e) => setFpCode(e.target.value)} placeholder="6 位验证码" />
              <button
                className="btn btn-sm"
                disabled={fpCountdown > 0 || !/^1\d{10}$/.test(fpPhone)}
                onClick={() => {
                  const code = issueCode(fpPhone)
                  setFpSent(code)
                  setFpCountdown(60)
                  const iv = window.setInterval(() => setFpCountdown((c) => (c <= 1 ? (window.clearInterval(iv), 0) : c - 1)), 1000)
                  toast(`【本地模拟】短信服务未接入,验证码:${code}`, { duration: 10000 })
                }}
              >
                {fpCountdown > 0 ? `${fpCountdown}s` : '获取验证码'}
              </button>
            </div>
            {fpSent && (
              <p className="fs12" style={{ color: 'var(--yellow-deep)' }}>
                【本地模拟】短信服务未接入,验证码直接显示:{fpSent}(10 分钟内有效)。真实短信需接入服务商并在服务端发送。
              </p>
            )}
            <Field label="设置新密码(至少 4 位)">
              <input className="input" type="password" value={fpPw} onChange={(e) => setFpPw(e.target.value)} />
            </Field>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                if (!/^1\d{10}$/.test(fpPhone)) {
                  toast('请输入正确的手机号', { kind: 'error' })
                  return
                }
                if (!checkCode(fpPhone, fpCode)) {
                  toast('验证码不正确或已过期', { kind: 'error' })
                  return
                }
                if (fpPw.length < 4) {
                  toast('新密码至少 4 位', { kind: 'error' })
                  return
                }
                const u = findByPhone(fpPhone)
                if (!u) {
                  toast('该手机号未绑定任何账号', { kind: 'error' })
                  return
                }
                setPassword(u.id, fpPw)
                toast(`密码已重置,请用账号「${u.name}」登录`, { kind: 'success' })
                setTab('quick')
                refresh()
              }}
            >
              重置密码
            </button>
            <p className="fs12 muted mt8">
              还没绑定手机号?当前版本请牢记密码;绑定入口在「个人角色 → 账号」。真实短信发送需接入短信服务商。
            </p>
          </div>
        )}

        {tab === 'quick' && (
          <div className="col" style={{ gap: 8 }}>
            {users.length === 0 && <p className="fs13 muted">还没有账号,先注册一个,或点下方快速体验。</p>}
            {users.map((u) => (
              <div key={u.id} className="node-h" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                <Icon name="user" size={16} />
                <b className="fs13 grow">{u.name}</b>
                {u.guest && <span className="chip">无密码</span>}
                <button className="btn btn-sm btn-primary" onClick={() => quickEnter(u)}>
                  进入
                </button>
              </div>
            ))}
            {pwFor && (
              <div className="col" style={{ border: '1px solid var(--primary-soft)', borderRadius: 8, padding: 10, background: 'var(--primary-weak)' }}>
                <Field label="输入密码">
                  <input
                    className="input"
                    type="password"
                    value={pw}
                    autoFocus
                    onChange={(e) => setPw(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitPw()}
                  />
                </Field>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm" onClick={() => setPwFor(null)}>取消</button>
                  <button className="btn btn-sm btn-primary" disabled={busy || !pw} onClick={submitPw}>登录</button>
                </div>
              </div>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const u = await createUser(`游客${String(Date.now()).slice(-4)}`)
                  toast('已创建临时账号(数据保存在本机)', { kind: 'success' })
                  enter(u)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Icon name="zap" size={14} /> 快速体验(免注册)
            </button>
            <button className="link-btn" onClick={() => setTab('forgot')}>
              忘记密码?(用绑定手机号找回)
            </button>
          </div>
        )}

        {tab === 'register' && (
          <div className="col">
            <Field label="昵称">
              <input className="input" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="2-12 个字符" />
            </Field>
            <Field label="密码" hint="至少 4 位;密码哈希后保存在本机,不会上传">
              <input className="input" type="password" value={regPw} onChange={(e) => setRegPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && register()} placeholder="至少 4 位" />
            </Field>
            <button className="btn btn-primary" style={{ marginTop: 4 }} disabled={busy} onClick={register}>
              创建账号
            </button>
            <p className="fs12 muted mt8">同一台设备可创建多个账号,各自的学习数据互相独立。</p>
          </div>
        )}

        {tab === 'scan' && (
          <div className="col" style={{ gap: 10 }}>
            <div className="explain-box">
              微信 / QQ 扫码登录需要接入对应开放平台(企业资质 + 服务端生成二维码与回调),密钥不能放在网页里。当前版本未接入,先使用本机账号;接入后此页面会直接显示二维码。
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn grow" disabled title="未接入微信开放平台">
                微信扫码登录(未接入)
              </button>
              <button className="btn grow" disabled title="未接入腾讯 QQ 互联">
                QQ 扫码登录(未接入)
              </button>
            </div>
            <p className="fs12 muted">接口已按可更换服务商预留(src/services/oauth.ts),接入时不改动学习功能。</p>
          </div>
        )}
      </div>
    </div>
  )
}

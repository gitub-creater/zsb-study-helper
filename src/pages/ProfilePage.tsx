// 个人角色:等级/经验/称号/成就徽章/解锁内容/经验记录
import React, { useState } from 'react'
import type { AvatarKind, ThemeKind } from '../types'
import { useStore } from '../store/store'
import { Avatar } from '../components/Avatar'
import { Mascot } from '../components/Mascot'
import { Chip, Field, Modal, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { levelInfo, xpForLevel } from '../lib/xp'
import { AVATAR_INFO, AVATAR_ORDER, THEMES, THEME_ORDER } from '../lib/theme'
import { fmtDateTime, todayStr } from '../lib/date'
import { masteredKpCount } from '../lib/selectors'
import {
  clearSession, getSession, getSessionUser, issueCode, checkCode, setPhone, setPassword, verifyPassword,
} from '../lib/auth'

function ringForLevel(level: number): string | undefined {
  if (level >= 5) return '#FFD34D'
  if (level >= 3) return '#C9D6E4'
  if (level >= 2) return '#E3A26B'
  return undefined
}

export function ProfilePage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [nickname, setNickname] = useState(state.profile?.nickname ?? '')
  const [avatar, setAvatar] = useState<AvatarKind>(state.profile?.avatar ?? 'sprout')
  const [theme, setTheme] = useState<ThemeKind>(state.profile?.theme ?? 'sky')

  // 账号:修改密码 / 绑定手机号
  const [pwOpen, setPwOpen] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw1, setNewPw1] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [sentCode, setSentCode] = useState('')
  const [countdown, setCountdown] = useState(0)

  if (!state.profile) return null
  const p = state.profile
  const level = levelInfo(state.xp)
  const sessUser = getSessionUser()
  // 产品策略:装扮/边框对全部用户直接解锁(成就徽章仍反映真实学习数据)
  const allUnlocked = true
  const ring = allUnlocked ? '#FFD34D' : ringForLevel(level.level)

  // 成就徽章(由真实学习数据推导)
  const perfectDay = Object.entries(
    state.attempts.reduce<Record<string, { n: number; ok: number }>>((acc, a) => {
      acc[a.date] = acc[a.date] ?? { n: 0, ok: 0 }
      acc[a.date].n += 1
      if (a.correct) acc[a.date].ok += 1
      return acc
    }, {})
  ).some(([, v]) => v.n >= 20 && v.ok / v.n >= 0.9)

  const badges: { id: string; name: string; desc: string; icon: IconName; got: boolean }[] = [
    { id: 'first', name: '初次登场', desc: '完成第一次练习', icon: 'sparkle', got: state.attempts.length >= 1 },
    { id: 'hundred', name: '百题斩', desc: '累计练习 100 题', icon: 'zap', got: state.attempts.length >= 100 },
    { id: 'streak7', name: '七日之约', desc: '连续学习 7 天', icon: 'fire', got: state.streak.best >= 7 },
    { id: 'steady', name: '稳定发挥', desc: '单日 20 题且正确率 ≥90%', icon: 'star', got: perfectDay },
    { id: 'reviewer', name: '复习达人', desc: '累计完成 20 次错题复习', icon: 'refresh', got: Object.values(state.wrong).reduce((s, e) => s + e.reviewLog.length, 0) >= 20 },
    { id: 'pioneer', name: '开荒者', desc: '掌握 10 个知识点', icon: 'cap', got: masteredKpCount(state) >= 10 },
  ]

  const unlocks = [
    { name: '铜色头像边框', need: '已开放', got: true },
    { name: '银色头像边框', need: '已开放', got: true },
    { name: '金色头像边框', need: '已开放', got: true },
    { name: '新称号解锁', need: '每一级', got: true },
    { name: '角色服装 / 校园场景 / 界面主题扩展', need: '全部开放', got: true },
    { name: '地图新区域(考试中心、毕业礼堂)', need: '全部开放', got: true },
  ]

  const todayCount = state.attempts.filter((a) => a.date === todayStr()).length

  return (
    <div>
      <div className="page-h">
        <h2>个人角色</h2>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() => {
            setNickname(p.nickname)
            setAvatar(p.avatar)
            setTheme(p.theme)
            setEditOpen(true)
          }}
        >
          <Icon name="edit" size={14} /> 编辑形象
        </button>
      </div>

      <div className="grid2">
        <div className="col">
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
              <Avatar kind={p.avatar} color={AVATAR_INFO[p.avatar].color} size={96} ring={ring} />
              <div style={{ textAlign: 'left' }}>
                <h2 style={{ fontSize: 20 }}>{p.nickname}</h2>
                <p className="fs13 muted">{p.major}</p>
                <div className="row mt8" style={{ flexWrap: 'wrap' }}>
                  <span className="level-chip">
                    <Icon name="cap" size={14} /> Lv.{level.level} {level.title}
                  </span>
                  {state.streak.current >= 2 && (
                    <span className="chip chip-yellow">
                      <Icon name="fire" size={12} /> 连续 {state.streak.current} 天
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt12" style={{ textAlign: 'left' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="fs13">经验值</span>
                <span className="fs12 muted num">
                  {state.xp} / {xpForLevel(level.level + 1)}(下一级还需 {xpForLevel(level.level + 1) - state.xp})
                </span>
              </div>
              <div className="xp-bar mt8">
                <i style={{ width: `${Math.round(level.progress * 100)}%` }} />
              </div>
              <p className="fs12 muted mt8">升级只解锁外观奖励(边框/称号等),不影响题目、掌握度与任何分析结果。</p>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="star" size={15} />
              </span>
              <b>成就徽章</b>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {badges.map((b) => (
                <div key={b.id} className={`badge${b.got ? '' : ' locked'}`} title={b.got ? '已达成' : '未达成'}>
                  <span className="ic">
                    <Icon name={b.icon} size={17} />
                  </span>
                  <b>{b.name}</b>
                  <span>{b.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="target" size={15} />
              </span>
              <b>学习足迹</b>
            </div>
            <div className="stat-line">
              <span>累计练习</span>
              <b className="num">{state.attempts.length} 题</b>
            </div>
            <div className="stat-line">
              <span>今日练习</span>
              <b className="num">{todayCount} 题</b>
            </div>
            <div className="stat-line">
              <span>已掌握知识点</span>
              <b className="num">{masteredKpCount(state)} 个</b>
            </div>
            <div className="stat-line">
              <span>连续学习</span>
              <b className="num">{state.streak.current} 天(最佳 {state.streak.best})</b>
            </div>
            <div className="stat-line">
              <span>收藏题目</span>
              <b className="num">{state.favorites.length} 道</b>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="sparkle" size={15} />
              </span>
              <b>解锁与装扮</b>
              {allUnlocked && (
                <div className="right">
                  <span className="chip chip-yellow">
                    <Icon name="star" size={12} /> 全部解锁
                  </span>
                </div>
              )}
            </div>
            <div className="col" style={{ gap: 7 }}>
              {unlocks.map((u) => (
                <div key={u.name} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="fs13">
                    {u.name} <span className="muted fs12">· {u.need}</span>
                  </span>
                  {u.got ? <Chip tone="green">已解锁</Chip> : <Chip>未解锁</Chip>}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="user" size={15} />
              </span>
              <b>账号</b>
              {allUnlocked && (
                <div className="right">
                  <span className="chip chip-yellow">
                    <Icon name="star" size={12} /> 特权账号
                  </span>
                </div>
              )}
            </div>
            <div className="stat-line">
              <span>当前账号</span>
              <b>{sessUser?.name ?? '本机'}</b>
            </div>
            <div className="stat-line">
              <span>绑定手机号</span>
              <b>{sessUser?.phone ?? '未绑定'}</b>
            </div>
            <div className="row mt8" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setPwOpen((v) => !v)}>
                <Icon name="edit" size={13} /> 修改密码
              </button>
              <button className="btn btn-sm" onClick={() => setPhoneOpen((v) => !v)}>
                <Icon name="mic" size={13} /> {sessUser?.phone ? '更换手机号' : '绑定手机号'}
              </button>
              <div className="grow" />
              <button
                className="btn btn-sm"
                onClick={() => {
                  clearSession()
                  window.location.reload()
                }}
              >
                <Icon name="left" size={13} /> 退出登录
              </button>
            </div>

            {pwOpen && (
              <div className="col mt8" style={{ border: '1px solid var(--primary-soft)', borderRadius: 8, padding: 10, background: 'var(--primary-weak)' }}>
                {!sessUser?.hash ? (
                  <p className="fs12 muted">当前是无密码账号,直接设置新密码即可。</p>
                ) : null}
                {sessUser?.hash ? (
                  <Field label="旧密码">
                    <input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                  </Field>
                ) : null}
                <Field label="新密码(至少 4 位)">
                  <input className="input" type="password" value={newPw1} onChange={(e) => setNewPw1(e.target.value)} />
                </Field>
                <Field label="确认新密码">
                  <input className="input" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
                </Field>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={async () => {
                      if (!sessUser) return
                      if (sessUser.hash) {
                        if (!(await verifyPassword(sessUser.id, oldPw))) {
                          toast('旧密码不正确', { kind: 'error' })
                          return
                        }
                      }
                      if (newPw1.length < 4) {
                        toast('新密码至少 4 位', { kind: 'error' })
                        return
                      }
                      if (newPw1 !== newPw2) {
                        toast('两次输入的新密码不一致', { kind: 'error' })
                        return
                      }
                      await setPassword(sessUser.id, newPw1)
                      setPwOpen(false); setOldPw(''); setNewPw1(''); setNewPw2('')
                      toast('密码已修改', { kind: 'success' })
                    }}
                  >
                    保存新密码
                  </button>
                </div>
              </div>
            )}

            {phoneOpen && (
              <div className="col mt8" style={{ border: '1px solid var(--primary-soft)', borderRadius: 8, padding: 10, background: 'var(--primary-weak)' }}>
                <Field label="手机号">
                  <input className="input" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="11 位手机号" maxLength={11} />
                </Field>
                <div className="row">
                  <input className="input grow" value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="6 位验证码" maxLength={6} />
                  <button
                    className="btn btn-sm"
                    disabled={countdown > 0 || !/^1\d{10}$/.test(phoneInput)}
                    onClick={() => {
                      const code = issueCode(phoneInput)
                      setSentCode(code)
                      setCountdown(60)
                      const iv = window.setInterval(() => setCountdown((c) => (c <= 1 ? (window.clearInterval(iv), 0) : c - 1)), 1000)
                      toast(`【本地模拟】短信服务未接入,验证码:${code}`, { duration: 10000 })
                    }}
                  >
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </button>
                </div>
                {sentCode && (
                  <p className="fs12" style={{ color: 'var(--yellow-deep)' }}>
                    【本地模拟】未接入短信服务商,验证码直接显示:{sentCode}(10 分钟内有效)。真实短信需接入服务商并在服务端发送。
                  </p>
                )}
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      if (!sessUser) return
                      if (!checkCode(phoneInput, phoneCode)) {
                        toast('验证码不正确或已过期', { kind: 'error' })
                        return
                      }
                      setPhone(sessUser.id, phoneInput)
                      setPhoneOpen(false); setPhoneCode(''); setSentCode('')
                      toast('手机号绑定成功(可用于找回密码)', { kind: 'success' })
                    }}
                  >
                    确认绑定
                  </button>
                </div>
              </div>
            )}

            <p className="fs12 muted mt8">微信/QQ 扫码登录需开放平台资质,当前版本提供本机账号密码登录;忘记密码可用绑定的手机号找回。</p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="clock" size={15} />
              </span>
              <b>最近经验记录</b>
            </div>
            {state.xpLog.length === 0 ? (
              <div className="row">
                <Mascot mood="think" size={48} />
                <p className="fs13 muted">还没有经验记录,完成今日任务就会有第一笔。</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {state.xpLog.slice(0, 8).map((l, i) => (
                  <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="fs13">{l.reason}</span>
                    <span className="fs12 muted num">
                      {fmtDateTime(new Date(l.t).toISOString())} · <b style={{ color: 'var(--yellow-deep)' }}>+{l.amount}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={editOpen}
        title="编辑角色形象"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setEditOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!nickname.trim()) {
                  toast('昵称不能为空', { kind: 'error' })
                  return
                }
                dispatch({ type: 'UPDATE_PROFILE', patch: { nickname: nickname.trim(), avatar, theme } })
                setEditOpen(false)
                toast('形象已更新', { kind: 'success' })
              }}
            >
              保存
            </button>
          </>
        }
      >
        <Field label="昵称">
          <input className="input" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <Field label="伙伴形象">
          <div className="avatar-pick">
            {AVATAR_ORDER.map((k) => (
              <button key={k} type="button" className={avatar === k ? 'on' : ''} onClick={() => setAvatar(k)}>
                <Avatar kind={k} color={AVATAR_INFO[k].color} size={48} />
                {AVATAR_INFO[k].name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="主题色">
          <div className="theme-pick">
            {THEME_ORDER.map((t) => (
              <button key={t} type="button" className={theme === t ? 'on' : ''} style={{ background: THEMES[t].primary }} aria-label={THEMES[t].name} onClick={() => setTheme(t)} />
            ))}
          </div>
        </Field>
      </Modal>
    </div>
  )
}

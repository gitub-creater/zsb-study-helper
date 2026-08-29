// 本地账号系统:注册 / 登录 / 多账号数据隔离(数据按用户分键存储,不出本机)
// 说明:微信/QQ 扫码登录需开放平台资质与服务端回调,见 services/oauth.ts;本地先提供账号密码与快速进入

export interface AuthUser {
  id: string
  name: string
  /** 有密码为正式账号,无密码为快速进入账号 */
  salt?: string
  hash?: string
  guest?: boolean
  /** 特权账号:全部解锁(跟随账号,不随学习数据丢失) */
  vip?: boolean
  /** 绑定手机号(用于找回密码,仅存本机) */
  phone?: string
  createdAt: string
}

export interface AuthSession {
  userId: string
  name: string
}

const USERS_KEY = 'zsb_users_v1'
const SESSION_KEY = 'zsb_session_v1'
export const LEGACY_USER_ID = 'local'

export function dataKey(userId: string): string {
  return `zsb_helper_v1__${userId}`
}

export function listUsers(): AuthUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    if (raw) return JSON.parse(raw) as AuthUser[]
  } catch {
    // ignore
  }
  return []
}

function saveUsers(users: AuthUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) return JSON.parse(raw) as AuthSession
  } catch {
    // ignore
  }
  return null
}

export function setSession(s: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function uid(): string {
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export async function hashHex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function makeSalt(): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 旧版本数据迁移:把 zsb_helper_v1 的数据归到"本机数据"账号,保留全部学习记录 */
export function ensureLegacyMigrated(): AuthUser[] {
  const users = listUsers()
  const legacy = localStorage.getItem('zsb_helper_v1')
  if (legacy && !users.some((u) => u.id === LEGACY_USER_ID)) {
    users.unshift({
      id: LEGACY_USER_ID,
      name: '本机数据',
      guest: true,
      createdAt: new Date().toISOString(),
    })
    localStorage.setItem(dataKey(LEGACY_USER_ID), legacy)
    localStorage.removeItem('zsb_helper_v1')
    saveUsers(users)
  }
  return users
}

export async function createUser(name: string, password?: string): Promise<AuthUser> {
  const users = listUsers()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请填写昵称')
  if (users.some((u) => u.name === trimmed)) throw new Error('该昵称已存在')
  const user: AuthUser = { id: uid(), name: trimmed, guest: !password, createdAt: new Date().toISOString() }
  if (password) {
    user.salt = makeSalt()
    user.hash = await hashHex(user.salt + password)
    user.guest = false
  }
  users.push(user)
  saveUsers(users)
  return user
}

export async function verifyPassword(id: string, password: string): Promise<boolean> {
  const user = listUsers().find((u) => u.id === id)
  if (!user || !user.salt || !user.hash) return false
  return (await hashHex(user.salt + password)) === user.hash
}

export async function setPassword(id: string, password: string): Promise<void> {
  const users = listUsers()
  const user = users.find((u) => u.id === id)
  if (!user) throw new Error('账号不存在')
  user.salt = makeSalt()
  user.hash = await hashHex(user.salt + password)
  user.guest = false
  saveUsers(users)
}

/** 当前登录用户(含 vip/phone 等账号属性) */
export function getSessionUser(): AuthUser | null {
  const s = getSession()
  if (!s) return null
  return listUsers().find((u) => u.id === s.userId) ?? null
}

export function setVip(id: string, vip: boolean): void {
  const users = listUsers()
  const user = users.find((u) => u.id === id)
  if (!user) return
  user.vip = vip
  saveUsers(users)
}

export function setPhone(id: string, phone: string): void {
  const users = listUsers()
  const user = users.find((u) => u.id === id)
  if (!user) throw new Error('账号不存在')
  user.phone = phone
  saveUsers(users)
}

/** 按手机号找回账号(最多匹配一个) */
export function findByPhone(phone: string): AuthUser | null {
  const hits = listUsers().filter((u) => u.phone === phone)
  return hits.length === 1 ? hits[0] : null
}

/** 本地验证码:未接入短信服务商时在界面明示"模拟验证码" */
const codeStore = new Map<string, { code: string; expires: number }>()

export function issueCode(phone: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  codeStore.set(phone, { code, expires: Date.now() + 10 * 60 * 1000 })
  return code
}

export function checkCode(phone: string, code: string): boolean {
  const hit = codeStore.get(phone)
  if (!hit) return false
  return hit.code === code && hit.expires > Date.now()
}

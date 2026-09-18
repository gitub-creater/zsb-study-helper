// 国内直连账号通道:vercel.app 在中国大陆被封(DNS 污染 + 真实 IP TLS 重置),
// 而 <project>.supabase.co 走 Cloudflare 实测可直连。这里把账号相关操作映射到
// 数据库 RPC(supabase/mainland-rpc.sql),供 services/cloud.ts 在主通道不可达时回退。
//
// 表结构和 RLS 完全不变:RPC 是 SECURITY DEFINER 函数,anon 仍然不能直接读写 app_users。
import type { State } from '../types'
import { SUPABASE_KEY, SUPABASE_URL, supabaseConfigured } from './supabaseClient'

export const cloudDirectConfigured = supabaseConfigured

/** 直连通道的虚拟入口标识:写进会话后能与真实 HTTP 入口区分开。 */
export const DIRECT_API_URL = 'supabase-direct'

export function isDirectApiUrl(value: string | undefined): boolean {
  return value === DIRECT_API_URL
}

export type DirectError = { code: string; error: string }

/** RPC 统一返回 JSON:业务失败带 code/error,成功返回各自的数据字段。 */
function isDirectError(value: unknown): value is DirectError {
  return Boolean(value && typeof value === 'object' && typeof (value as DirectError).code === 'string')
}

const DIRECT_REQUEST_TIMEOUT_MS = 30000
const DIRECT_AUTH_TIMEOUT_MS = 10000

async function rpc<T>(name: string, args: Record<string, unknown>, timeoutMs = DIRECT_REQUEST_TIMEOUT_MS): Promise<T> {
  if (!cloudDirectConfigured) throw new Error('direct_not_configured')
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`direct_http_${response.status}`)
    return await response.json() as T
  } finally {
    globalThis.clearTimeout(timer)
  }
}

export interface DirectAuthOk {
  user: { id: string; name: string; email?: string }
  token: string
}

export type DirectAuthResult = DirectAuthOk | DirectError

export async function directRegister(id: string, name: string, password: string, email?: string): Promise<DirectAuthResult> {
  if (!email?.trim()) {
    // Keep registration compatible with databases that have not run the email migration yet.
    return rpc<DirectAuthResult>('zsb_register', { p_id: id, p_name: name, p_password: password }, DIRECT_AUTH_TIMEOUT_MS)
  }
  return rpc<DirectAuthResult>('zsb_register', { p_id: id, p_name: name, p_password: password, p_email: email.trim().toLowerCase() }, DIRECT_AUTH_TIMEOUT_MS)
}

export async function directLogin(name: string, password: string): Promise<DirectAuthResult> {
  return rpc<DirectAuthResult>('zsb_login', { p_name: name, p_password: password }, DIRECT_AUTH_TIMEOUT_MS)
}

export function directAuthFailed(value: DirectAuthResult): value is DirectError {
  return isDirectError(value)
}

export async function directFindUsers(token: string, query: string): Promise<{ id: string; name: string }[]> {
  const result = await rpc<{ users?: { id: string; name: string }[] } | DirectError>('zsb_find_users', {
    p_token: token,
    p_query: query,
  })
  if (isDirectError(result)) throw new Error(result.code)
  return result.users ?? []
}

export type DirectStateResult =
  | { kind: 'state'; state: State }
  | { kind: 'empty' }
  | { kind: 'expired' }

export async function directGetState(token: string): Promise<DirectStateResult> {
  const result = await rpc<{ state?: State | null } | DirectError>('zsb_get_state', { p_token: token })
  if (isDirectError(result)) {
    if (result.code === 'unauthorized') return { kind: 'expired' }
    throw new Error(result.code)
  }
  // zsb_get_state 总会带上 state 键(无记录时为 null)。缺键说明响应被网关或代理改写过,
  // 绝不能当成"云端为空",否则会用本机数据覆盖云端已有快照。
  if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'state')) {
    throw new Error('invalid_response')
  }
  const state = result.state
  if (state === null || state === undefined) return { kind: 'empty' }
  if (typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid_response')
  return { kind: 'state', state }
}

export async function directPutState(token: string, state: State): Promise<void> {
  const result = await rpc<{ ok?: boolean } | DirectError>('zsb_put_state', { p_token: token, p_state: state })
  if (isDirectError(result)) throw new Error(result.code)
  // 只有明确的 ok 才算写入成功;否则上层会把未同步的数据标记成已同步。
  if (!result || typeof result !== 'object' || (result as { ok?: boolean }).ok !== true) {
    throw new Error('invalid_response')
  }
}

/** 改密码:直连通道自己即可完成,成功后其余设备的会话会被数据库端注销。 */
export async function directChangePassword(token: string, oldPassword: string, newPassword: string): Promise<void> {
  const result = await rpc<{ ok?: boolean } | DirectError>('zsb_change_password', {
    p_token: token,
    p_old: oldPassword,
    p_new: newPassword,
  })
  if (isDirectError(result)) throw new Error(result.error || result.code)
}

/**
 * 早期账号的密码由主通道用 scrypt 存储,数据库端无法校验。
 * 主通道登录成功后调用一次,把同一密码补写成 bcrypt,此后该账号在国内也能直接登录。
 * 失败不影响本次登录,下次登录会再试。
 */
export async function directAdoptPassword(token: string, password: string): Promise<boolean> {
  try {
    const result = await rpc<{ ok?: boolean } | DirectError>('zsb_adopt_password', {
      p_token: token,
      p_password: password,
    })
    return !isDirectError(result)
  } catch {
    return false
  }
}

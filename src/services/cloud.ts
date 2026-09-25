import { getSession, setSession } from '../lib/auth'
import type { State } from '../types'
import { SUPABASE_KEY, SUPABASE_URL } from './supabaseClient'
import {
  DIRECT_API_URL, cloudDirectConfigured, directAdoptPassword, directAuthFailed, directChangePassword,
  directFindUsers, directGetState, directLoginVerified, directRegisterVerified, directResetPassword, directPutState, isDirectApiUrl,
} from './cloudDirect'

export interface CloudSession {
  token: string
  apiUrl: string
}

export interface CloudUser {
  id: string
  name: string
}

export type CloudNetworkState = 'unknown' | 'online' | 'offline' | 'expired'
export type CloudSyncState = 'idle' | 'syncing' | 'synced' | 'pending'

export interface CloudStatus {
  network: CloudNetworkState
  sync: CloudSyncState
  apiUrl?: string
  message?: string
  at?: number
}

let cloudStatus: CloudStatus = { network: 'unknown', sync: 'idle' }
const statusListeners = new Set<() => void>()

export function getCloudStatus(): CloudStatus {
  return cloudStatus
}

export function subscribeCloudStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function setCloudSyncState(sync: CloudSyncState, message?: string): void {
  cloudStatus = { ...cloudStatus, sync, message, at: Date.now() }
  statusListeners.forEach((listener) => listener())
}

function setCloudNetworkState(network: CloudNetworkState, apiUrl?: string, message?: string): void {
  cloudStatus = { ...cloudStatus, network, apiUrl: apiUrl ?? cloudStatus.apiUrl, message, at: Date.now() }
  statusListeners.forEach((listener) => listener())
}

export async function findCloudUsers(session: CloudSession, query: string): Promise<CloudUser[]> {
  const value = query.trim()
  if (!value) return []
  // 会话本身就是直连签发的,不必再撞一次被封的主通道。
  if (isDirectApiUrl(session.apiUrl)) return directFindUsers(session.token, value)

  const encoded = encodeURIComponent(value)
  try {
    const { data, apiUrl } = await request<{ users: CloudUser[] }>(`/api/auth/users?q=${encoded}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    }, session.apiUrl, (body) => Array.isArray(body.users) && body.users.every((user) => user && typeof user.id === 'string' && typeof user.name === 'string'))
    session.apiUrl = apiUrl
    saveCloudApiUrl(apiUrl)
    return data.users
  } catch (error) {
    // 好友搜索在国内最容易撞到 vercel.app 被封;两条通道共用 app_sessions,令牌可直接复用。
    if (!cloudDirectConfigured || !(error instanceof CloudRequestError) || !isUnavailable(error)) throw error
    const users = await directFindUsers(session.token, value)
    session.apiUrl = DIRECT_API_URL
    setCloudNetworkState('online', DIRECT_API_URL)
    return users
  }
}

export type CloudLoginResult =
  | { kind: 'ok'; user: CloudUser; session: CloudSession }
  | { kind: 'not_found' }
  | { kind: 'bad_password' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

export { CloudRequestError }

const API_URL_KEY = 'zsb_cloud_api_url_v1'
const DEFAULT_CLOUD_API_URLS = [
  'https://shandong-zsb-study-helper.vercel.app',
  'https://zsb-study-helper.vercel.app',
]
const GITHUB_PAGES_HOST = 'gitub-creater.github.io'
// 实测生产注册接口耗时 2.0-4.2 秒(Vercel Serverless 冷启动 + Supabase 跨区往返,
// 一次注册要串行完成查重/哈希/写账号/建会话)。原来的 5 秒预算刚好卡在这个区间,
// 稍慢的网络就会被中止并误判成"云端不可用",于是只建本机账号、好友搜不到。
const CLOUD_REQUEST_TIMEOUT_MS = 20000
/** 注册/登录这类一次性关键请求允许更久,写库成功却超时会让账号两边不一致。 */
const CLOUD_AUTH_REQUEST_TIMEOUT_MS = 30000
const CLOUD_TOTAL_TIMEOUT_MS = 45000
const CLOUD_AUTH_TOTAL_TIMEOUT_MS = 75000
const RETRY_DELAYS_MS = [400, 1200]

function isGithubPagesHost(): boolean {
  return typeof window !== 'undefined'
    && (window.location.hostname === GITHUB_PAGES_HOST || window.location.hostname.endsWith(`.${GITHUB_PAGES_HOST}`))
}

function isLocalOrLanHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalOrLanHost(url.hostname))
  } catch {
    return false
  }
}

function configuredApiUrls(): string[] {
  const env = import.meta.env as Record<string, string | undefined>
  return [env.VITE_CLOUD_API_URLS, env.VITE_CLOUD_API_URL]
    .flatMap((value) => (value ?? '').split(/[;,]/))
    .map(normalizeUrl)
    .filter((value) => Boolean(value) && isHttpUrl(value))
}

function readSavedApiUrl(): string {
  try {
    return typeof localStorage === 'undefined' ? '' : localStorage.getItem(API_URL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function getCloudApiUrls(preferred?: string): string[] {
  const location = typeof window === 'undefined' ? null : window.location
  const saved = readSavedApiUrl()
  const sameOrigin = location
    && location.protocol !== 'file:'
    && !isLocalOrLanHost(location.hostname)
    && !isGithubPagesHost()
    ? normalizeUrl(location.origin)
    : ''
  // 已成功的入口优先于旧会话里的地址，避免每次同步重新撞上故障域名。
  return [...new Set([
    normalizeUrl(saved),
    normalizeUrl(preferred ?? ''),
    sameOrigin,
    ...configuredApiUrls(),
    ...DEFAULT_CLOUD_API_URLS,
  ].filter((value) => Boolean(value) && isHttpUrl(value)))]
}

/**
 * AI 服务密钥是设备私密配置，不能随着学习快照跨设备传播。
 * 这个函数同时处理新旧云端数据：旧快照即使历史上意外保存过密钥，
 * 下载到客户端后也只会得到一个空值副本。
 */
export function removeAiApiKeyFromCloudState(state: State | null): State | null {
  const ai = state?.settings?.ai
  if (!state || !ai) return state
  const customHeaders = Object.fromEntries(
    Object.entries(ai.customHeaders ?? {}).filter(([name]) => !/(authorization|api[-_]?key|token|secret|cookie|password)/i.test(name))
  )
  return {
    ...state,
    settings: {
      ...state.settings,
      ai: { ...ai, apiKey: '', customHeaders },
    },
  }
}

/**
 * 云端状态只能带学习数据。本机已保存的密钥优先，且不依赖远端是否干净，
 * 以防旧版本写入的密钥在升级过渡期间重新覆盖当前设备。
 */
export function retainLocalAiApiKey(remoteState: State, localState: State): State {
  const localAi = localState.settings?.ai
  if (!localAi?.apiKey) return remoteState
  const remoteAi = remoteState.settings?.ai
  const localHeaders = localAi.customHeaders ?? {}
  return {
    ...remoteState,
    settings: {
      ...remoteState.settings,
      ai: { ...(remoteAi ?? localAi), apiKey: localAi.apiKey, customHeaders: { ...(remoteAi?.customHeaders ?? {}), ...localHeaders } },
    },
  }
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getCloudApiUrl(): string | null {
  return getCloudApiUrls()[0] ?? null
}

export function saveCloudApiUrl(value: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const url = normalizeUrl(value)
    if (url) localStorage.setItem(API_URL_KEY, url)
    else localStorage.removeItem(API_URL_KEY)
  } catch {
    // 隐私模式或 Electron 未就绪时本地存储可能不可写，不应影响云请求本身。
  }
}

class CloudRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
    message = '云端服务暂时不可用',
    public readonly retryable = false,
    public readonly apiUrl?: string,
  ) {
    super(message)
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  preferredApiUrl?: string,
  validate?: (body: T) => boolean,
  /** 注册/登录用更宽的预算:超时会让云端写成功而本机认为失败。 */
  slow = false,
): Promise<{ data: T; apiUrl: string }> {
  const urls = getCloudApiUrls(preferredApiUrl)
  if (urls.length === 0) throw new CloudRequestError(0, 'not_configured', '未配置云端地址')

  let lastError: CloudRequestError | null = null
  const perRequestTimeout = slow ? CLOUD_AUTH_REQUEST_TIMEOUT_MS : CLOUD_REQUEST_TIMEOUT_MS
  const deadline = Date.now() + (slow ? CLOUD_AUTH_TOTAL_TIMEOUT_MS : CLOUD_TOTAL_TIMEOUT_MS)
  for (const apiUrl of urls) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (Date.now() >= deadline) break

      try {
        const remaining = Math.min(perRequestTimeout, deadline - Date.now())
        if (remaining <= 0) break
        const response = await fetchWithTimeout(`${apiUrl}${path}`, init, remaining)
        const body = await response.json().catch(() => null) as ({ error?: string; code?: string } & T) | null
        if (!response.ok) {
          throw new CloudRequestError(
            response.status,
            body?.code,
            body?.error,
            response.status >= 500 && response.status <= 599,
            apiUrl,
          )
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || (validate && !validate(body))) {
          // 可能是误指向静态站点或网关错误页；切换候选入口，而不是伪造成功。
          throw new CloudRequestError(0, 'invalid_response', '云端返回的数据格式不正确', true, apiUrl)
        }
        setCloudNetworkState('online', apiUrl)
        saveCloudApiUrl(apiUrl)
        rememberSuccessfulApiUrl(apiUrl, init)
        return { data: body, apiUrl }
      } catch (error) {
        const cloudError = error instanceof CloudRequestError
          ? error
          : new CloudRequestError(0, 'unavailable', '网络连接失败，请检查当前网络', true, apiUrl)
        lastError = cloudError
        // 账号不存在、密码错误等是确定性业务结果，不要换域名重复请求。
        if (!cloudError.retryable) {
          setCloudNetworkState(cloudError.status === 401 ? 'expired' : 'online', cloudError.apiUrl, cloudError.message)
          throw cloudError
        }
        if (attempt >= RETRY_DELAYS_MS.length) break
        await wait(RETRY_DELAYS_MS[attempt])
      }
    }
  }

  const finalError = lastError ?? new CloudRequestError(0, 'unavailable')
  setCloudNetworkState(finalError.status === 401 ? 'expired' : 'offline', finalError.apiUrl, finalError.message)
  throw finalError
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch (error) {
    const wasCancelled = init.signal?.aborted
    const wasTimeout = !wasCancelled && error instanceof DOMException && error.name === 'AbortError'
    const apiUrl = new URL(url).origin
    throw new CloudRequestError(
      0,
      wasTimeout ? 'timeout' : 'unavailable',
      wasTimeout ? '云端请求超时，请稍后重试' : '网络连接失败，请检查当前网络',
      !wasCancelled,
      apiUrl,
    )
  } finally {
    globalThis.clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abort)
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function rememberSuccessfulApiUrl(apiUrl: string, init: RequestInit): void {
  const authorization = new Headers(init.headers).get('Authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return
  const current = getSession()
  if (!current || current.cloudToken !== token || current.cloudApiUrl === apiUrl) return
  setSession({ ...current, cloudApiUrl: apiUrl })
}

function toLoginResult(
  response: { user: CloudUser; token: string },
  apiUrl: string
): CloudLoginResult {
  if (!response.user || typeof response.user.id !== 'string' || typeof response.user.name !== 'string' || typeof response.token !== 'string' || !response.token) {
    return { kind: 'error', message: '云端返回的数据格式不正确，请稍后重试' }
  }
  return { kind: 'ok', user: response.user, session: { token: response.token, apiUrl } }
}

function isUnavailable(error: CloudRequestError): boolean {
  return error.status === 0
    || (error.status >= 500 && error.status <= 599)
    || error.code === 'not_configured'
    || error.code === 'service_unavailable'
    || error.code === 'invalid_response'
}

/** 直连 RPC 的业务错误码 → 统一登录结果。 */
function directResultToLogin(result: Awaited<ReturnType<typeof directLoginVerified>>): CloudLoginResult | null {
  if (!directAuthFailed(result)) {
    return { kind: 'ok', user: result.user, session: { token: result.token, apiUrl: DIRECT_API_URL } }
  }
  if (result.code === 'not_found') return { kind: 'not_found' }
  if (result.code === 'bad_password') return { kind: 'bad_password' }
  if (result.code === 'name_taken') return { kind: 'error', message: '该账号已在云端注册，请直接登录' }
  // legacy_account 表示该账号的密码摘要只有主通道能校验,交给调用方继续等主通道。
  if (result.code === 'legacy_account') return null
  return { kind: 'error', message: result.error }
}

export async function updateCloudPassword(
  session: CloudSession,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  if (isDirectApiUrl(session.apiUrl)) {
    await directChangePassword(session.token, oldPassword, newPassword)
    return
  }
  try {
    const { apiUrl } = await request('/api/auth/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ oldPassword, newPassword }),
    }, session.apiUrl)
    session.apiUrl = apiUrl
  } catch (error) {
    const cloudError = error instanceof CloudRequestError ? error : null
    if (!(cloudDirectConfigured && cloudError && isUnavailable(cloudError))) throw error
    await directChangePassword(session.token, oldPassword, newPassword)
    session.apiUrl = DIRECT_API_URL
    setCloudNetworkState('online', DIRECT_API_URL)
  }
}

export type CloudDownloadResult =
  | { kind: 'state'; state: State; apiUrl: string }
  | { kind: 'empty'; apiUrl: string }
  | { kind: 'error'; message: string; expired: boolean }

/** 直连通道的快照结果 → 统一下载结果。 */
async function directDownload(session: CloudSession): Promise<CloudDownloadResult> {
  try {
    const result = await directGetState(session.token)
    if (result.kind === 'expired') return { kind: 'error', message: '登录已过期，请重新登录', expired: true }
    session.apiUrl = DIRECT_API_URL
    setCloudNetworkState('online', DIRECT_API_URL)
    if (result.kind === 'empty') return { kind: 'empty', apiUrl: DIRECT_API_URL }
    return { kind: 'state', state: removeAiApiKeyFromCloudState(result.state)!, apiUrl: DIRECT_API_URL }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : '云端服务暂时不可用', expired: false }
  }
}

export async function downloadCloudStateResult(session: CloudSession): Promise<CloudDownloadResult> {
  if (isDirectApiUrl(session.apiUrl)) return directDownload(session)
  try {
    const { data, apiUrl } = await request<{ state: State | null }>('/api/state', {
      headers: { Authorization: `Bearer ${session.token}` },
    }, session.apiUrl, (body) => Object.prototype.hasOwnProperty.call(body, 'state') && (body.state === null || (typeof body.state === 'object' && !Array.isArray(body.state))))
    if (!Object.prototype.hasOwnProperty.call(data, 'state') || (data.state !== null && typeof data.state !== 'object')) {
      return { kind: 'error', message: '云端返回的数据格式不正确', expired: false }
    }
    if (data.state === null) return { kind: 'empty', apiUrl }
    return { kind: 'state', state: removeAiApiKeyFromCloudState(data.state)!, apiUrl }
  } catch (error) {
    const cloudError = error instanceof CloudRequestError ? error : null
    // 会话令牌两条通道共用同一张 app_sessions 表，因此主通道被封时可以直接改走直连。
    if (cloudError && cloudError.status !== 401 && isUnavailable(cloudError) && cloudDirectConfigured) {
      const viaDirect = await directDownload(session)
      if (viaDirect.kind !== 'error') return viaDirect
    }
    return { kind: 'error', message: cloudError?.message ?? '云端服务暂时不可用', expired: cloudError?.status === 401 }
  }
}

/** 兼容旧调用方：需要区分请求失败时请使用 downloadCloudStateResult。 */
export async function downloadCloudState(session: CloudSession): Promise<State | null> {
  const result = await downloadCloudStateResult(session)
  return result.kind === 'state' ? result.state : null
}

export async function uploadCloudState(session: CloudSession, state: State): Promise<boolean> {
  setCloudSyncState('syncing')
  // AI 密钥属于设备私密配置。学习数据可以云同步，但密钥绝不离开当前设备。
  const cloudState = removeAiApiKeyFromCloudState(state)!

  if (isDirectApiUrl(session.apiUrl)) {
    try {
      await directPutState(session.token, cloudState)
      setCloudSyncState('synced')
      return true
    } catch (error) {
      setCloudSyncState('pending', error instanceof Error ? error.message : '云端同步失败')
      return false
    }
  }

  try {
    await request('/api/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ state: cloudState }),
    }, session.apiUrl)
    setCloudSyncState('synced')
    return true
  } catch (error) {
    // 主通道被封锁时同一个会话令牌可以直接走 supabase.co(会话表是同一张)。
    const cloudError = error instanceof CloudRequestError ? error : null
    if (cloudDirectConfigured && cloudError && isUnavailable(cloudError)) {
      try {
        await directPutState(session.token, cloudState)
        session.apiUrl = DIRECT_API_URL
        setCloudNetworkState('online', DIRECT_API_URL)
        setCloudSyncState('synced')
        return true
      } catch {
        // 直连也失败则按原来的待同步处理
      }
    }
    setCloudSyncState('pending', error instanceof Error ? error.message : '云端同步失败')
    return false
  }
}

// ============ 严格邮箱二次认证 ============

export type AuthCodePurpose = 'login' | 'register' | 'reset_password'

export type SendCodeResult =
  | { kind: 'ok'; expiresIn: number }
  | { kind: 'rate_limited'; waitSeconds: number }
  | { kind: 'error'; message: string }

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function validEmail(email: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i.test(email)
}

export async function sendVerificationCode(email: string, purpose: AuthCodePurpose = 'login'): Promise<SendCodeResult> {
  const trimmedEmail = normalizeEmail(email)
  if (!validEmail(trimmedEmail)) return { kind: 'error', message: '邮箱格式不正确' }

  if (cloudDirectConfigured) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ email: trimmedEmail, purpose }),
        signal: AbortSignal.timeout(CLOUD_AUTH_REQUEST_TIMEOUT_MS),
      })
      const data = await response.json().catch(() => null) as { success?: boolean; expiresIn?: number; error?: string; waitSeconds?: number } | null
      if (response.ok && data?.success) {
        setCloudNetworkState('online', DIRECT_API_URL)
        return { kind: 'ok', expiresIn: data.expiresIn || 600 }
      }
      if (response.status === 429 || data?.waitSeconds) {
        return { kind: 'rate_limited', waitSeconds: data?.waitSeconds || 60 }
      }
      if (response.status >= 400 && response.status < 500) {
        return { kind: 'error', message: data?.error || '验证码请求被拒绝' }
      }
      // Edge Function 服务端错误时才回退 Vercel，避免因业务错误重复发送。
    } catch {
      // 大陆网络优先直连 Supabase；不可达时再尝试 Vercel。
    }
  }

  try {
    const { data, apiUrl } = await request<{
      success: boolean
      expiresIn?: number
      error?: string
      waitSeconds?: number
    }>('/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email: trimmedEmail, purpose }),
    }, undefined, undefined, true)
    saveCloudApiUrl(apiUrl)
    setCloudNetworkState('online', apiUrl)
    if (!data.success) {
      if (data.waitSeconds) return { kind: 'rate_limited', waitSeconds: data.waitSeconds }
      return { kind: 'error', message: data.error || '发送失败' }
    }
    return { kind: 'ok', expiresIn: data.expiresIn || 600 }
  } catch (error) {
    const cloudError = error instanceof CloudRequestError ? error : null
    if (cloudError && isUnavailable(cloudError)) {
      setCloudNetworkState('offline', undefined, '云端服务暂时不可用')
      return { kind: 'error', message: '验证码服务连接失败，请检查网络后重试' }
    }
    return { kind: 'error', message: cloudError?.message || '发送验证码失败' }
  }
}

async function strictAuthRequest<T>(path: string, body: Record<string, unknown>): Promise<{ data: T; apiUrl: string }> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) }, undefined, undefined, true)
}

export async function loginCloud(name: string, password: string, email = '', code = '', preferDirect = true): Promise<CloudLoginResult> {
  if (!name.trim() || !password || !validEmail(normalizeEmail(email)) || !/^\d{6}$/.test(code.trim())) {
    return { kind: 'error', message: '请输入账号、密码、邮箱和 6 位验证码' }
  }
  const normalizedEmail = normalizeEmail(email)
  if (preferDirect && cloudDirectConfigured) {
    try {
      const mapped = directResultToLogin(await directLoginVerified(name, password, normalizedEmail, code.trim()))
      if (mapped) {
        setCloudNetworkState('online', DIRECT_API_URL)
        return mapped
      }
    } catch {
      // 直连失败时回退主通道,仍携带完整认证信息。
    }
  }
  try {
    const { data, apiUrl } = await strictAuthRequest<{ user: CloudUser; token: string }>('/api/auth/login', { name, password, email: normalizedEmail, code: code.trim() })
    return toLoginResult(data, apiUrl)
  } catch (error) {
    if (!(error instanceof CloudRequestError)) return { kind: 'unavailable' }
    if (cloudDirectConfigured && isUnavailable(error)) {
      try {
        const mapped = directResultToLogin(await directLoginVerified(name, password, normalizedEmail, code.trim()))
        if (mapped) {
          setCloudNetworkState('online', DIRECT_API_URL)
          return mapped
        }
      } catch {
        // 直连也不可用时保持不可达结果。
      }
    }
    if (error.code === 'not_found') return { kind: 'not_found' }
    if (error.code === 'bad_password') return { kind: 'bad_password' }
    if (error.code === 'invalid_code') return { kind: 'error', message: '验证码错误或已过期，请重新获取' }
    if (error.code === 'email_mismatch') return { kind: 'error', message: '邮箱与账号绑定信息不一致' }
    if (error.code === 'email_taken') return { kind: 'error', message: '该邮箱已绑定其他账号' }
    if (isUnavailable(error)) return { kind: 'unavailable' }
    return { kind: 'error', message: error.message }
  }
}

export async function registerCloud(id: string, name: string, password: string, email = '', code = '', preferDirect = true): Promise<CloudLoginResult> {
  if (!validEmail(normalizeEmail(email)) || !/^\d{6}$/.test(code.trim())) return { kind: 'error', message: '注册必须填写邮箱并验证 6 位验证码' }
  const normalizedEmail = normalizeEmail(email)
  if (preferDirect && cloudDirectConfigured) {
    try {
      const mapped = directResultToLogin(await directRegisterVerified(id, name, password, normalizedEmail, code.trim()))
      if (mapped) {
        setCloudNetworkState('online', DIRECT_API_URL)
        return mapped
      }
    } catch {
      // 直连失败时回退主通道,仍携带验证码。
    }
  }
  try {
    const { data, apiUrl } = await strictAuthRequest<{ user: CloudUser; token: string }>('/api/auth/register', { id, name, password, email: normalizedEmail, code: code.trim() })
    return toLoginResult(data, apiUrl)
  } catch (error) {
    if (!(error instanceof CloudRequestError)) return { kind: 'unavailable' }
    if (cloudDirectConfigured && isUnavailable(error)) {
      try {
        const mapped = directResultToLogin(await directRegisterVerified(id, name, password, normalizedEmail, code.trim()))
        if (mapped) {
          setCloudNetworkState('online', DIRECT_API_URL)
          return mapped
        }
      } catch {
        // 直连也不可用时保持不可达结果。
      }
    }
    if (error.code === 'name_taken') return { kind: 'error', message: '该账号已存在' }
    if (error.code === 'email_taken') return { kind: 'error', message: '该邮箱已被注册' }
    if (error.code === 'invalid_code') return { kind: 'error', message: '验证码错误或已过期，请重新获取' }
    if (isUnavailable(error)) return { kind: 'unavailable' }
    return { kind: 'error', message: error.message }
  }
}

export async function resetCloudPassword(email: string, code: string, newPassword: string, confirmPassword: string): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  const normalizedEmail = normalizeEmail(email)
  if (!validEmail(normalizedEmail) || !/^\d{6}$/.test(code.trim()) || newPassword.length < 4 || newPassword !== confirmPassword) return { kind: 'error', message: '邮箱、验证码或新密码格式不正确' }
  try {
    if (cloudDirectConfigured) {
      try {
        await directResetPassword(normalizedEmail, code.trim(), newPassword)
        setCloudNetworkState('online', DIRECT_API_URL)
        return { kind: 'ok' }
      } catch {
        // 直连失败时回退主通道,仍携带完整验证码。
      }
    }
    const { apiUrl } = await strictAuthRequest<{ ok: boolean }>('/api/auth/reset-password', { email: normalizedEmail, code: code.trim(), newPassword, confirmPassword })
    saveCloudApiUrl(apiUrl)
    setCloudNetworkState('online', apiUrl)
    return { kind: 'ok' }
  } catch (error) {
    const cloudError = error instanceof CloudRequestError ? error : null
    if (cloudError?.code === 'invalid_code') return { kind: 'error', message: '验证码错误或已过期，请重新获取' }
    if (cloudError?.code === 'not_found') return { kind: 'error', message: '邮箱未绑定账号' }
    if (cloudError && isUnavailable(cloudError)) return { kind: 'error', message: '网络连接失败，请稍后重试' }
    return { kind: 'error', message: cloudError?.message || '重置密码失败' }
  }
}

/** 兼容旧调用方但不再允许邮箱密码绕过验证码。 */
export async function loginCloudWithEmail(): Promise<CloudLoginResult> {
  return { kind: 'error', message: '邮箱密码登录已升级，请使用账号、密码和邮箱验证码' }
}


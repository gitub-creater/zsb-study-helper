import { getSession, setSession } from '../lib/auth'
import type { State } from '../types'
import {
  DIRECT_API_URL, cloudDirectConfigured, directAdoptPassword, directAuthFailed, directChangePassword,
  directFindUsers, directGetState, directLogin, directPutState, directRegister, isDirectApiUrl,
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
function directResultToLogin(result: Awaited<ReturnType<typeof directLogin>>): CloudLoginResult | null {
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

export async function loginCloud(name: string, password: string): Promise<CloudLoginResult> {
  try {
    const { data, apiUrl } = await request<{ user: CloudUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    }, undefined, (body) => Boolean(body.user && typeof body.user.id === 'string' && typeof body.user.name === 'string' && typeof body.token === 'string' && body.token), true)
    const ok = toLoginResult(data, apiUrl)
    // 主通道可达时顺手把旧账号的密码摘要补写成数据库可校验的格式,
    // 之后在没有代理的国内网络也能直接登录。失败不影响本次登录。
    if (ok.kind === 'ok' && cloudDirectConfigured) void directAdoptPassword(ok.session.token, password)
    return ok
  } catch (error) {
    if (!(error instanceof CloudRequestError)) return { kind: 'unavailable' }
    if (error.code === 'not_found') return { kind: 'not_found' }
    if (error.code === 'bad_password') return { kind: 'bad_password' }
    if (isUnavailable(error) && cloudDirectConfigured) {
      // 主通道在国内被封锁时改走 supabase.co 直连,账号数据仍是同一张表。
      try {
        const mapped = directResultToLogin(await directLogin(name, password))
        if (mapped) {
          setCloudNetworkState('online', DIRECT_API_URL)
          return mapped
        }
      } catch {
        // 直连也失败则按原来的不可达处理
      }
    }
    if (isUnavailable(error)) return { kind: 'unavailable' }
    return { kind: 'error', message: error.message }
  }
}

export async function registerCloud(id: string, name: string, password: string): Promise<CloudLoginResult> {
  try {
    const { data, apiUrl } = await request<{ user: CloudUser; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ id, name, password }),
    }, undefined, (body) => Boolean(body.user && typeof body.user.id === 'string' && typeof body.user.name === 'string' && typeof body.token === 'string' && body.token), true)
    const ok = toLoginResult(data, apiUrl)
    if (ok.kind === 'ok' && cloudDirectConfigured) void directAdoptPassword(ok.session.token, password)
    return ok
  } catch (error) {
    if (!(error instanceof CloudRequestError)) return { kind: 'unavailable' }
    if (error.code === 'name_taken') return { kind: 'error', message: '该账号已在云端注册，请直接登录' }
    if (isUnavailable(error) && cloudDirectConfigured) {
      // 国内网络连不上主通道时直接写库,注册因此不再依赖 vercel.app 是否可达。
      // RPC 与主通道同样是"同 ID 同密码可安全复用",重试不会建出重复账号。
      try {
        const mapped = directResultToLogin(await directRegister(id, name, password))
        if (mapped) {
          setCloudNetworkState('online', DIRECT_API_URL)
          return mapped
        }
      } catch {
        // 直连也失败则按原来的不可达处理
      }
    }
    if (isUnavailable(error)) return { kind: 'unavailable' }
    return { kind: 'error', message: error.message }
  }
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

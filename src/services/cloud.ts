import type { State } from '../types'

export interface CloudSession {
  token: string
  apiUrl: string
}

export interface CloudUser {
  id: string
  name: string
}

export type CloudLoginResult =
  | { kind: 'ok'; user: CloudUser; session: CloudSession }
  | { kind: 'not_found' }
  | { kind: 'bad_password' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

const API_URL_KEY = 'zsb_cloud_api_url_v1'

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getCloudApiUrl(): string | null {
  const configured = normalizeUrl(import.meta.env.VITE_CLOUD_API_URL ?? '')
  if (configured) return configured

  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return window.location.origin
  }

  return normalizeUrl(localStorage.getItem(API_URL_KEY) ?? '') || null
}

export function saveCloudApiUrl(value: string): void {
  const url = normalizeUrl(value)
  if (url) localStorage.setItem(API_URL_KEY, url)
  else localStorage.removeItem(API_URL_KEY)
}

class CloudRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
    message = '云端服务暂时不可用'
  ) {
    super(message)
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  apiUrl = getCloudApiUrl()
): Promise<{ data: T; apiUrl: string }> {
  if (!apiUrl) throw new CloudRequestError(0, 'not_configured', '未配置云端地址')

  let response: Response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new CloudRequestError(0, 'unavailable')
  }

  const body = await response.json().catch(() => ({})) as { error?: string; code?: string } & T
  if (!response.ok) throw new CloudRequestError(response.status, body.code, body.error)
  return { data: body, apiUrl }
}

function toLoginResult(
  response: { user: CloudUser; token: string },
  apiUrl: string
): CloudLoginResult {
  return { kind: 'ok', user: response.user, session: { token: response.token, apiUrl } }
}

export async function loginCloud(name: string, password: string): Promise<CloudLoginResult> {
  try {
    const { data, apiUrl } = await request<{ user: CloudUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    })
    return toLoginResult(data, apiUrl)
  } catch (error) {
    if (!(error instanceof CloudRequestError)) return { kind: 'unavailable' }
    if (error.code === 'not_found') return { kind: 'not_found' }
    if (error.code === 'bad_password') return { kind: 'bad_password' }
    if (error.status === 0 || error.code === 'not_configured') return { kind: 'unavailable' }
    return { kind: 'error', message: error.message }
  }
}

export async function registerCloud(id: string, name: string, password: string): Promise<CloudLoginResult> {
  try {
    const { data, apiUrl } = await request<{ user: CloudUser; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ id, name, password }),
    })
    return toLoginResult(data, apiUrl)
  } catch (error) {
    if (!(error instanceof CloudRequestError)) return { kind: 'unavailable' }
    if (error.code === 'name_taken') return { kind: 'error', message: '该账号已在云端注册，请直接登录' }
    if (error.status === 0 || error.code === 'not_configured') return { kind: 'unavailable' }
    return { kind: 'error', message: error.message }
  }
}

export async function updateCloudPassword(
  session: CloudSession,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  await request('/api/auth/password', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ oldPassword, newPassword }),
  }, session.apiUrl)
}

export async function downloadCloudState(session: CloudSession): Promise<State | null> {
  try {
    const { data } = await request<{ state: State | null }>('/api/state', {
      headers: { Authorization: `Bearer ${session.token}` },
    }, session.apiUrl)
    return data.state
  } catch {
    return null
  }
}

export async function uploadCloudState(session: CloudSession, state: State): Promise<boolean> {
  try {
    await request('/api/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ state }),
    }, session.apiUrl)
    return true
  } catch {
    return false
  }
}

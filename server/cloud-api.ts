import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

type RequestLike = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type ResponseLike = {
  status: (code: number) => ResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
  end: () => void
}

export type ApiRequest = RequestLike
export type ApiResponse = ResponseLike

export interface CloudUserRow {
  id: string
  name: string
  name_normalized: string
  password_salt: string
  password_hash: string
}

const SESSION_DAYS = 30

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

export function db() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function setCors(req: ApiRequest, res: ApiResponse): void {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  const allowed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const allowOrigin = origin && (allowed.length === 0 || allowed.includes(origin)) ? origin : '*'
  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Vary', 'Origin')
}

export function handleOptions(req: ApiRequest, res: ApiResponse): boolean {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

export function sendError(res: ApiResponse, status: number, code: string, error: string): void {
  res.status(status).json({ code, error })
}

export function getBody<T>(req: ApiRequest): T {
  if (typeof req.body === 'string') return JSON.parse(req.body) as T
  return (req.body ?? {}) as T
}

export function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase('zh-CN')
}

export function validName(name: string): boolean {
  return name.trim().length >= 2 && name.trim().length <= 12
}

export function validPassword(password: string): boolean {
  return password.length >= 4 && password.length <= 128
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { salt: string; hash: string } {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') }
}

export function passwordMatches(password: string, salt: string, expected: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt).hash, 'hex')
  const stored = Buffer.from(expected, 'hex')
  return actual.length === stored.length && timingSafeEqual(actual, stored)
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await db().from('app_sessions').insert({
    token_hash: tokenHash(token),
    user_id: userId,
    expires_at: expiresAt,
  })
  if (error) throw error
  return token
}

export async function sessionUser(req: ApiRequest): Promise<CloudUserRow | null> {
  const authorization = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  const { data: session, error: sessionError } = await db()
    .from('app_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle()
  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) return null

  const { data: user, error: userError } = await db()
    .from('app_users')
    .select('id, name, name_normalized, password_salt, password_hash')
    .eq('id', session.user_id)
    .maybeSingle()
  if (userError || !user) return null
  return user as CloudUserRow
}

export function publicUser(user: Pick<CloudUserRow, 'id' | 'name'>): { id: string; name: string } {
  return { id: user.id, name: user.name }
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type EmailCodePurpose = 'login' | 'register' | 'reset_password'

interface CodeTicket {
  email: string
  purpose: EmailCodePurpose
  code: string
  expiresAt: number
  nonce: string
}

function secret(): string {
  return process.env.EMAIL_CODE_SECRET || process.env.RESEND_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function issueEmailCodeTicket(email: string, purpose: EmailCodePurpose, code: string, expiresInSeconds = 600): string {
  const ticket: CodeTicket = {
    email: email.trim().toLowerCase(),
    purpose,
    code,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    nonce: randomBytes(16).toString('base64url'),
  }
  const payload = Buffer.from(JSON.stringify(ticket), 'utf8').toString('base64url')
  return `${payload}.${signature(payload)}`
}

export function verifyEmailCodeTicket(token: string | undefined, email: string, purpose: EmailCodePurpose, code: string): boolean {
  if (!token || !secret()) return false
  const [payload, supplied] = token.split('.')
  if (!payload || !supplied) return false
  try {
    const expected = signature(payload)
    const a = Buffer.from(supplied)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CodeTicket>
    return ticket.email === email.trim().toLowerCase()
      && ticket.purpose === purpose
      && ticket.code === code.trim()
      && typeof ticket.expiresAt === 'number'
      && ticket.expiresAt > Date.now()
  } catch {
    return false
  }
}

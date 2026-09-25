// API Route: /api/auth/send-code
// 发送用途隔离的邮箱验证码
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../_lib/cloud-api.js'

type CodePurpose = 'login' | 'register' | 'reset_password'

interface SendCodeRequest {
  email?: string
  purpose?: CodePurpose
}

interface SendCodeResponse {
  success: boolean
  expiresIn?: number
  error?: string
  waitSeconds?: number
}

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i
const PURPOSE_LABEL: Record<CodePurpose, string> = {
  login: '登录',
  register: '注册',
  reset_password: '重置密码',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  const origin = req.headers.origin ?? ''
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as SendCodeRequest
    const email = body.email?.trim().toLowerCase() ?? ''
    const purpose = body.purpose
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: '邮箱格式不正确' } satisfies SendCodeResponse)
    }
    if (!purpose || !Object.prototype.hasOwnProperty.call(PURPOSE_LABEL, purpose)) {
      return res.status(400).json({ success: false, error: '验证码用途不正确' } satisfies SendCodeResponse)
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] as string
      || 'unknown'
    const { data, error } = await db().rpc('send_verification_code', {
      p_email: email,
      p_code: code,
      p_purpose: purpose,
      p_ip: ip,
    })
    if (error) {
      console.error('[send-code] Supabase error:', error)
      return res.status(503).json({ success: false, error: '服务暂时不可用，请稍后重试' } satisfies SendCodeResponse)
    }
    if (!data?.success) return res.status(429).json(data as SendCodeResponse)

    const sent = await sendEmail(email, code, PURPOSE_LABEL[purpose])
    if (!sent) return res.status(502).json({ success: false, error: '邮件发送失败，请稍后重试' } satisfies SendCodeResponse)
    return res.status(200).json({ success: true, expiresIn: data.expiresIn || 600 } satisfies SendCodeResponse)
  } catch (error) {
    console.error('[send-code] Unexpected error:', error)
    return res.status(500).json({ success: false, error: '服务器错误' } satisfies SendCodeResponse)
  }
}

async function sendEmail(email: string, code: string, purposeLabel: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'noreply@yourdomain.com'
  if (!apiKey) {
    console.error('[send-code] RESEND_API_KEY 未配置')
    return false
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: `【专升本学习助手】${purposeLabel}验证码`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#1a1a1a">专升本学习助手</h2><p style="color:#4a4a4a;font-size:16px">您的${purposeLabel}验证码是：</p><div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:20px 0;text-align:center"><span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb">${code}</span></div><p style="color:#6b6b6b;font-size:14px">验证码有效期为<strong>10分钟</strong>，请尽快使用。如果这不是您的操作，请忽略此邮件。</p></div>`,
    }),
  })
  if (!response.ok) {
    console.error('[send-code] Resend API error:', await response.text())
    return false
  }
  return true
}

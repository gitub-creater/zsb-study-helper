// 旧邮箱+密码登录入口已停用，避免绕过邮箱验证码。
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin ?? ''
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  return res.status(410).json({ code: 'password_login_disabled', error: '请使用账号、密码和邮箱验证码登录' })
}

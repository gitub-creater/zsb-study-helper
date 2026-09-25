// 旧验证码直登入口已停用。
// 新客户端必须通过账号密码和用途为 login 的邮箱验证码登录。
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin ?? ''
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  return res.status(410).json({ code: 'verification_login_disabled', error: '请使用账号、密码和邮箱验证码登录' })
}

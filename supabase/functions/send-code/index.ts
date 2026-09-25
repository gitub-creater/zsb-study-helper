import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Purpose = 'login' | 'register' | 'reset_password'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const emailFrom = Deno.env.get('EMAIL_FROM') ?? 'noreply@yourdomain.com'
const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i
const labels: Record<Purpose, string> = {
  login: '登录',
  register: '注册',
  reset_password: '重置密码',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)
  const suppliedKey = request.headers.get('apikey') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!anonKey || suppliedKey !== anonKey) return json({ success: false, error: '无效的客户端凭据' }, 401)
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    console.error('[send-code] missing server secrets')
    return json({ success: false, error: '邮件服务尚未配置' }, 503)
  }

  try {
    const body = await request.json() as { email?: string; purpose?: Purpose }
    const email = body.email?.trim().toLowerCase() ?? ''
    const purpose = body.purpose
    if (!emailPattern.test(email)) return json({ success: false, error: '邮箱格式不正确' }, 400)
    if (!purpose || !Object.prototype.hasOwnProperty.call(labels, purpose)) {
      return json({ success: false, error: '验证码用途不正确' }, 400)
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const { data, error } = await admin.rpc('send_verification_code', {
      p_email: email,
      p_code: code,
      p_purpose: purpose,
      p_ip: ip,
    })
    if (error) {
      console.error('[send-code] RPC error:', error.message)
      return json({ success: false, error: '验证码服务暂时不可用' }, 503)
    }
    if (!data?.success) return json(data, 429)

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom,
        to: email,
        subject: `【专升本学习助手】${labels[purpose]}验证码`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px"><h2>专升本学习助手</h2><p>您的${labels[purpose]}验证码是：</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#f5f5f5;padding:16px;margin:20px 0">${code}</div><p>验证码有效期为<strong>10分钟</strong>。如果这不是您的操作，请忽略此邮件。</p></div>`,
      }),
    })
    if (!response.ok) {
      console.error('[send-code] Resend status:', response.status)
      return json({ success: false, error: '邮件服务发送失败，请稍后重试' }, 502)
    }
    return json({ success: true, expiresIn: data.expiresIn ?? 600 })
  } catch (error) {
    console.error('[send-code] unexpected error:', error instanceof Error ? error.message : 'unknown')
    return json({ success: false, error: '验证码发送失败，请稍后重试' }, 500)
  }
})

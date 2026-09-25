import { afterEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ url: 'https://project.example.supabase.co', key: 'anon-test-key', enabled: true }))

vi.mock('../src/services/supabaseClient', () => ({
  get SUPABASE_URL() { return config.url },
  get SUPABASE_KEY() { return config.key },
  get supabaseConfigured() { return config.enabled },
  getSupabase: () => null,
}))

function storage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  config.enabled = true
})

describe('邮箱验证码发送通道', () => {
  it.each(['123456789@qq.com', 'student@foxmail.com'])('Supabase 直连支持 %s', async (email) => {
    storage()
    const fetchMock = vi.fn().mockResolvedValue(ok({ success: true, expiresIn: 600 }))
    vi.stubGlobal('fetch', fetchMock)
    const { sendVerificationCode } = await import('../src/services/cloud')

    const result = await sendVerificationCode(email, 'login')
    expect(result.kind).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${config.url}/functions/v1/send-code`)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ email, purpose: 'login' })
    expect(new Headers(init.headers).get('apikey')).toBe(config.key)
  })

  it('Supabase 直连不可达时回退 Vercel 且保留用途参数', async () => {
    storage()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok({ success: true, expiresIn: 600 }))
    vi.stubGlobal('fetch', fetchMock)
    const { sendVerificationCode } = await import('../src/services/cloud')

    const result = await sendVerificationCode('123456789@qq.com', 'reset_password')
    expect(result.kind).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/auth/send-code')
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ email: '123456789@qq.com', purpose: 'reset_password' })
  })

  it('直连频率限制直接显示等待时间，不再回退发送第二次', async () => {
    storage()
    const fetchMock = vi.fn().mockResolvedValue(ok({ success: false, waitSeconds: 38, error: '请稍后再试' }, 429))
    vi.stubGlobal('fetch', fetchMock)
    const { sendVerificationCode } = await import('../src/services/cloud')

    expect(await sendVerificationCode('123456789@qq.com', 'login')).toEqual({ kind: 'rate_limited', waitSeconds: 38 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

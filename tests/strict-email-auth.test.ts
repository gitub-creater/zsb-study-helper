import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

vi.mock('../src/services/supabaseClient', () => ({
  SUPABASE_URL: '',
  SUPABASE_KEY: '',
  supabaseConfigured: false,
  getSupabase: () => null,
}))

function installStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.resetModules()
})

describe('严格邮箱认证客户端', () => {
  it('缺少邮箱或验证码时拒绝登录和注册，不发送网络请求', async () => {
    installStorage()
    vi.stubGlobal('fetch', fetchMock)
    const { loginCloud, registerCloud } = await import('../src/services/cloud')

    expect((await loginCloud('账号01', 'pw1234')).kind).toBe('error')
    expect((await registerCloud('u_auth01', '账号01', 'pw1234')).kind).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('发送验证码时携带用途字段', async () => {
    installStorage()
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, expiresIn: 600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    const { sendVerificationCode } = await import('../src/services/cloud')

    const result = await sendVerificationCode('student@example.com', 'reset_password')
    expect(result.kind).toBe('ok')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ email: 'student@example.com', purpose: 'reset_password' })
  })

  it('重置密码要求用途验证码与两次一致的新密码', async () => {
    installStorage()
    vi.stubGlobal('fetch', fetchMock)
    const { resetCloudPassword } = await import('../src/services/cloud')

    expect((await resetCloudPassword('student@example.com', '123456', 'pw1234', 'different')).kind).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

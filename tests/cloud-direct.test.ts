// 国内直连通道:vercel.app 在大陆被封时,账号相关操作改走 supabase.co 的 RPC。
// 这些用例只验证纯逻辑与回退分支,不访问真实网络。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SUPABASE_URL = 'https://example.supabase.co'
const SUPABASE_KEY = 'sb_publishable_test'

vi.mock('../src/services/supabaseClient', () => ({
  SUPABASE_URL,
  SUPABASE_KEY,
  supabaseConfigured: true,
  getSupabase: () => null,
}))

function stubStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
}

/** 主通道请求一律失败(模拟 vercel.app 被封),直连 RPC 按传入的应答表回应。 */
function stubFetch(rpcResponses: Record<string, unknown>): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()
    calls.push(href)
    const rpc = href.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)
    if (!rpc) {
      // 主通道:模拟 TLS 被重置,与真实被封表现一致
      throw new TypeError('Failed to fetch')
    }
    const name = href.slice(`${SUPABASE_URL}/rest/v1/rpc/`.length)
    if (!(name in rpcResponses)) throw new Error(`未预期的 RPC: ${name}`)
    // 校验密钥头确实带上了,否则 Supabase 会返回 401
    const headers = new Headers(init?.headers)
    expect(headers.get('apikey')).toBe(SUPABASE_KEY)
    return new Response(JSON.stringify(rpcResponses[name]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return { calls }
}

beforeEach(() => stubStorage())
afterEach(() => vi.unstubAllGlobals())

describe('国内直连通道', () => {
  it('新注册直连优先成功时不请求 Vercel', async () => {
    const { calls } = stubFetch({ zsb_register: { user: { id: 'u_fast1', name: '快速用户' }, token: 'tok_fast1' } })
    const { registerCloud } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')

    const result = await registerCloud('u_fast1', '快速用户', 'pw1234', true)
    expect(result.kind).toBe('ok')
    expect(result.kind === 'ok' && result.session.apiUrl).toBe(DIRECT_API_URL)
    expect(calls).toEqual([`${SUPABASE_URL}/rest/v1/rpc/zsb_register`])
  })

  it('新注册直连失败时才回退到 Vercel 主通道', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString()
      calls.push(href)
      if (href.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) throw new TypeError('直连失败')
      return new Response(JSON.stringify({ user: { id: 'u_fast2', name: '回退用户' }, token: 'tok_fast2' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { registerCloud } = await import('../src/services/cloud')

    const result = await registerCloud('u_fast2', '回退用户', 'pw1234', true)
    expect(result.kind).toBe('ok')
    expect(calls[0]).toBe(`${SUPABASE_URL}/rest/v1/rpc/zsb_register`)
    expect(calls.some((url) => url.endsWith('/api/auth/register'))).toBe(true)
  })

  it('登录直连优先成功时不请求 Vercel', async () => {
    const { calls } = stubFetch({ zsb_login: { user: { id: 'u_login1', name: '快速登录' }, token: 'tok_login1' } })
    const { loginCloud } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')

    const result = await loginCloud('快速登录', 'pw1234')
    expect(result.kind).toBe('ok')
    expect(result.kind === 'ok' && result.session.apiUrl).toBe(DIRECT_API_URL)
    expect(calls).toEqual([`${SUPABASE_URL}/rest/v1/rpc/zsb_login`])
  })

  it('旧 scrypt 账号直连返回 legacy_account 后回退 Vercel', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString()
      calls.push(href)
      if (href === `${SUPABASE_URL}/rest/v1/rpc/zsb_login`) {
        return new Response(JSON.stringify({ code: 'legacy_account', error: '旧账号' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ user: { id: 'u_legacy1', name: '旧账号' }, token: 'tok_legacy1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { loginCloud } = await import('../src/services/cloud')

    const result = await loginCloud('旧账号', 'pw1234')
    expect(result.kind).toBe('ok')
    expect(calls[0]).toBe(`${SUPABASE_URL}/rest/v1/rpc/zsb_login`)
    expect(calls.some((url) => url.endsWith('/api/auth/login'))).toBe(true)
  })

  it('登录直连失败后回退 Vercel', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString()
      calls.push(href)
      if (href.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) throw new TypeError('直连失败')
      return new Response(JSON.stringify({ user: { id: 'u_login2', name: '回退登录' }, token: 'tok_login2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { loginCloud } = await import('../src/services/cloud')

    const result = await loginCloud('回退登录', 'pw1234')
    expect(result.kind).toBe('ok')
    expect(calls[0]).toBe(`${SUPABASE_URL}/rest/v1/rpc/zsb_login`)
    expect(calls.some((url) => url.endsWith('/api/auth/login'))).toBe(true)
  })

  it('主通道被封时注册自动改走直连,并记住直连入口', async () => {
    stubFetch({ zsb_register: { user: { id: 'u_a1', name: '小明' }, token: 'tok_a1' }, zsb_adopt_password: { ok: true } })
    const { registerCloud } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')

    const result = await registerCloud('u_a1', '小明', 'pw1234')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.user).toEqual({ id: 'u_a1', name: '小明' })
    // 会话记下直连入口,后续同步不再反复撞被封的域名
    expect(result.session.apiUrl).toBe(DIRECT_API_URL)
  })

  it('主通道被封时登录自动改走直连', async () => {
    stubFetch({ zsb_login: { user: { id: 'u_b2', name: '小红' }, token: 'tok_b2' } })
    const { loginCloud } = await import('../src/services/cloud')

    const result = await loginCloud('小红', 'pw1234')
    expect(result.kind).toBe('ok')
  })

  it('直连返回的业务错误按语义映射,不会被当成网络故障', async () => {
    stubFetch({ zsb_login: { code: 'bad_password', error: '密码不正确' } })
    const { loginCloud } = await import('../src/services/cloud')
    expect((await loginCloud('小红', 'wrong')).kind).toBe('bad_password')
  })

  it('账号不存在时直连也返回 not_found,登录页才能提示先注册', async () => {
    stubFetch({ zsb_login: { code: 'not_found', error: '账号不存在' } })
    const { loginCloud } = await import('../src/services/cloud')
    expect((await loginCloud('nobody', 'pw1234')).kind).toBe('not_found')
  })

  it('旧账号的 scrypt 密码只有主通道能校验,直连返回 legacy_account 时保持不可达语义', async () => {
    stubFetch({ zsb_login: { code: 'legacy_account', error: '该账号需要先在主通道登录一次完成升级' } })
    const { loginCloud } = await import('../src/services/cloud')
    // 不能谎报密码错误:此时应让上层按"云端暂时不可用"处理,保留本机离线登录
    expect((await loginCloud('老账号', 'pw1234')).kind).toBe('unavailable')
  })

  it('好友搜索在会话已是直连入口时直接走 RPC', async () => {
    const { calls } = stubFetch({ zsb_find_users: { users: [{ id: 'u_c3', name: '同学' }] } })
    const { findCloudUsers } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')

    const users = await findCloudUsers({ token: 'tok', apiUrl: DIRECT_API_URL }, '同学')
    expect(users).toEqual([{ id: 'u_c3', name: '同学' }])
    // 只打 RPC,不再尝试被封的主通道
    expect(calls.every((url) => url.includes('/rest/v1/rpc/'))).toBe(true)
  })

  it('好友搜索在主通道超时后回退直连(这正是"加好友网络超时"的修复)', async () => {
    stubFetch({ zsb_find_users: { users: [{ id: 'u_d4', name: '同桌' }] } })
    const { findCloudUsers } = await import('../src/services/cloud')

    const users = await findCloudUsers({ token: 'tok', apiUrl: 'https://blocked.vercel.app' }, '同桌')
    expect(users).toEqual([{ id: 'u_d4', name: '同桌' }])
  })

  it('直连读写学习快照:空快照与真实快照要能区分', async () => {
    stubFetch({ zsb_get_state: { state: null }, zsb_put_state: { ok: true } })
    const { downloadCloudStateResult, uploadCloudState } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')
    const session = { token: 'tok', apiUrl: DIRECT_API_URL }

    expect((await downloadCloudStateResult(session)).kind).toBe('empty')
    expect(await uploadCloudState(session, { settings: {} } as never)).toBe(true)
  })

  it('直连上传时不会把设备私密的 AI 密钥送上云端', async () => {
    let uploaded: unknown = null
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (!href.includes('/rest/v1/rpc/zsb_put_state')) throw new TypeError('Failed to fetch')
      uploaded = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const { uploadCloudState } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')

    const state = { settings: { ai: { apiKey: 'sk-secret', customHeaders: { Authorization: 'Bearer x' } } } }
    expect(await uploadCloudState({ token: 'tok', apiUrl: DIRECT_API_URL }, state as never)).toBe(true)
    const sent = JSON.stringify(uploaded)
    expect(sent).not.toContain('sk-secret')
    expect(sent).not.toContain('Bearer x')
  })

  it('直连会话过期要如实报告过期,不能静默当成空快照覆盖云端', async () => {
    stubFetch({ zsb_get_state: { code: 'unauthorized', error: '登录已过期，请重新登录' } })
    const { downloadCloudStateResult } = await import('../src/services/cloud')
    const { DIRECT_API_URL } = await import('../src/services/cloudDirect')

    const result = await downloadCloudStateResult({ token: 'stale', apiUrl: DIRECT_API_URL })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.expired).toBe(true)
  })

  it('未配置 Supabase 时不启用直连,保持原有不可达语义', async () => {
    vi.resetModules()
    vi.doMock('../src/services/supabaseClient', () => ({
      SUPABASE_URL: '', SUPABASE_KEY: '', supabaseConfigured: false, getSupabase: () => null,
    }))
    stubFetch({})
    const { loginCloud } = await import('../src/services/cloud')
    expect((await loginCloud('小红', 'pw1234')).kind).toBe('unavailable')
    vi.doUnmock('../src/services/supabaseClient')
    vi.resetModules()
  })
})

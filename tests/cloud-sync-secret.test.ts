import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadCloudState,
  downloadCloudStateResult,
  getCloudApiUrls,
  removeAiApiKeyFromCloudState,
  retainLocalAiApiKey,
  uploadCloudState,
} from '../src/services/cloud'
import type { State } from '../src/types'

function stateWithApiKey(apiKey: string): State {
  return {
    settings: {
      ai: {
        provider: 'openai-compatible',
        baseURL: 'https://example.test/v1',
        apiKey,
        model: 'test-model',
      },
    },
  } as State
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('云端网络适配', () => {
  it('国内网络下会保留首选地址并提供第二生产入口', () => {
    const urls = getCloudApiUrls('https://primary.example.test')
    expect(urls[0]).toBe('https://primary.example.test')
    expect(urls).toContain('https://shandong-zsb-study-helper.vercel.app')
    expect(urls).toContain('https://zsb-study-helper.vercel.app')
  })

  it('下载失败与云端明确为空必须区分', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('dns')))
    await expect(downloadCloudStateResult({ token: 'token', apiUrl: 'https://sync.example.test' })).resolves.toMatchObject({ kind: 'error' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: null }) }))
    await expect(downloadCloudStateResult({ token: 'token', apiUrl: 'https://sync.example.test' })).resolves.toMatchObject({ kind: 'empty' })
  })

  it('第一个入口异常时会切换到第二个入口，并记住成功地址', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('dns'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: null }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(downloadCloudStateResult({ token: 'token', apiUrl: 'https://primary.example.test' })).resolves.toMatchObject({ kind: 'empty' })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://primary.example.test/api/state')
  })

  it('大陆中转因余额不足返回410时会直接切换到Vercel', async () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', hostname: '' } })
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url)
      calls.push(href)
      if (href.startsWith('https://1496092367-jkwjpfq51u.ap-beijing.tencentscf.com/')) {
        return new Response(JSON.stringify({
          errorMessage: 'Function is Unavailable, AvailableStatus = InsufficientBalance.',
          statusCode: 410,
        }), { status: 410 })
      }
      return new Response(JSON.stringify({ code: 'bad_password', error: '密码不正确' }), { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { loginCloud } = await import('../src/services/cloud')

    const result = await loginCloud('虚构账号', 'fake-password', 'fake@example.test', '123456', false)

    expect(result.kind).toBe('bad_password')
    expect(calls).toEqual([
      'https://1496092367-jkwjpfq51u.ap-beijing.tencentscf.com/api/auth/login',
      'https://shandong-zsb-study-helper.vercel.app/api/auth/login',
    ])
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      name: '虚构账号',
      password: 'fake-password',
      email: 'fake@example.test',
      code: '123456',
    })
  })

  it('普通410业务错误不会切换云端入口', async () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', hostname: '' } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'verification_login_disabled',
      error: '请使用账号、密码和邮箱验证码登录',
    }), { status: 410 }))
    vi.stubGlobal('fetch', fetchMock)
    const { loginCloud } = await import('../src/services/cloud')

    const result = await loginCloud('虚构账号', 'fake-password', 'fake@example.test', '123456', false)

    expect(result).toMatchObject({ kind: 'error', message: '请使用账号、密码和邮箱验证码登录' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['bad_password', '密码不正确'],
    ['invalid_code', '验证码错误或已过期，请重新获取'],
  ])('登录返回%s时不会切换入口', async (code, message) => {
    vi.stubGlobal('window', { location: { protocol: 'file:', hostname: '' } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, error: '服务端业务错误' }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const { loginCloud } = await import('../src/services/cloud')

    expect(await loginCloud('虚构账号', 'fake-password', 'fake@example.test', '123456', false)).toMatchObject({
      kind: code === 'bad_password' ? 'bad_password' : 'error',
      ...(code === 'invalid_code' ? { message } : {}),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('验证码入口返回429时不会重复发送到其他域名', async () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', hostname: '' } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'rate_limited',
      error: '发送过于频繁，请稍后再试',
      waitSeconds: 38,
    }), { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const { sendVerificationCode } = await import('../src/services/cloud')

    expect(await sendVerificationCode('fake@example.test', 'login')).toMatchObject({ kind: 'error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://1496092367-jkwjpfq51u.ap-beijing.tencentscf.com/api/auth/send-code')
  })

  it('HTML 或缺字段响应不会被当成成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await expect(downloadCloudStateResult({ token: 'token', apiUrl: 'https://sync.example.test' })).resolves.toMatchObject({ kind: 'error' })
  })
})

describe('云同步 AI 密钥隔离', () => {
  it('下载历史云端快照时无条件清除其中的 API Key，且不修改响应对象', async () => {
    const oldCloudState = stateWithApiKey('old-cloud-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: oldCloudState }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const downloaded = await downloadCloudState({ token: 'token', apiUrl: 'https://sync.example.test' })

    expect(downloaded?.settings.ai?.apiKey).toBe('')
    expect(downloaded).not.toBe(oldCloudState)
    expect(oldCloudState.settings.ai?.apiKey).toBe('old-cloud-key')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.test/api/state',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) })
    )
  })

  it('本机已有密钥始终优先，即使调用方传入了带密钥的旧远端状态', () => {
    const merged = retainLocalAiApiKey(stateWithApiKey('old-cloud-key'), stateWithApiKey('current-device-key'))

    expect(merged.settings.ai?.apiKey).toBe('current-device-key')
    expect(merged.settings.ai).toMatchObject({ provider: 'openai-compatible', model: 'test-model' })
  })

  it('上传快照也会发送不含 API Key 的副本', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadCloudState({ token: 'token', apiUrl: 'https://sync.example.test' }, stateWithApiKey('device-key'))).resolves.toBe(true)

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as { state: State }
    expect(body.state.settings.ai?.apiKey).toBe('')
    expect(removeAiApiKeyFromCloudState(null)).toBeNull()
  })
})

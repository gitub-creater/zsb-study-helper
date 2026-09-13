import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 注册补偿队列直接调用 registerCloud;这里替换掉真实网络请求,只验证重试与状态收敛。
const registerCloud = vi.fn()
vi.mock('../src/services/cloud', () => ({ registerCloud: (...args: unknown[]) => registerCloud(...args) }))

function installStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
}

async function loadQueue() {
  vi.resetModules()
  return await import('../src/services/cloudRegistrationQueue')
}

beforeEach(() => {
  installStorage()
  registerCloud.mockReset()
})

afterEach(() => vi.unstubAllGlobals())

describe('云端注册补偿队列', () => {
  it('注册超时后进入队列，并标记账号待同步', async () => {
    const { queueCloudRegistration, pendingRegistrationCount } = await loadQueue()
    const { createUser, listUsers } = await import('../src/lib/auth')

    const user = await createUser('慢网用户', 'pw1234', 'u_slow01')
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })

    expect(pendingRegistrationCount()).toBe(1)
    expect(listUsers().find((u) => u.id === 'u_slow01')?.cloudRegistrationPending).toBe(true)
  })

  it('后台重试成功后清除待同步标记并写回云端会话', async () => {
    const { queueCloudRegistration, flush, pendingRegistrationCount } = await loadQueue()
    const { createUser, listUsers, setSession, getSession } = await import('../src/lib/auth')

    const user = await createUser('补注册用户', 'pw1234', 'u_retry01')
    setSession({ userId: user.id, name: user.name })
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })

    registerCloud.mockResolvedValue({
      kind: 'ok',
      user: { id: 'u_retry01', name: '补注册用户' },
      session: { token: 'tok_ok', apiUrl: 'https://api.example.com' },
    })
    await flush()

    expect(pendingRegistrationCount()).toBe(0)
    expect(listUsers().find((u) => u.id === 'u_retry01')?.cloudRegistrationPending).toBeUndefined()
    expect(getSession()?.cloudToken).toBe('tok_ok')
    expect(getSession()?.cloudApiUrl).toBe('https://api.example.com')
  })

  it('账号已被占用是确定性错误，不再无限重试', async () => {
    const { queueCloudRegistration, flush, pendingRegistrationCount } = await loadQueue()
    const { createUser } = await import('../src/lib/auth')

    const user = await createUser('重名用户', 'pw1234', 'u_taken01')
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })

    registerCloud.mockResolvedValue({ kind: 'error', message: '该账号已在云端注册，请直接登录' })
    await flush()

    expect(pendingRegistrationCount()).toBe(0)
    expect(registerCloud).toHaveBeenCalledTimes(1)
  })

  it('仍然不可用时保留在队列中继续等待重试', async () => {
    const { queueCloudRegistration, flush, pendingRegistrationCount } = await loadQueue()
    const { createUser, listUsers } = await import('../src/lib/auth')

    const user = await createUser('离线用户', 'pw1234', 'u_off01')
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })

    registerCloud.mockResolvedValue({ kind: 'unavailable' })
    await flush()

    expect(pendingRegistrationCount()).toBe(1)
    expect(listUsers().find((u) => u.id === 'u_off01')?.cloudRegistrationPending).toBe(true)
  })

  it('退出登录可清除内存中的密码', async () => {
    const { queueCloudRegistration, clearQueuedRegistration, pendingRegistrationCount } = await loadQueue()
    const { createUser } = await import('../src/lib/auth')

    const user = await createUser('退出用户', 'pw1234', 'u_exit01')
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })
    expect(pendingRegistrationCount()).toBe(1)

    clearQueuedRegistration(user.id)
    expect(pendingRegistrationCount()).toBe(0)
  })
})

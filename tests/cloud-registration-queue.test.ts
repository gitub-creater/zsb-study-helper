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

  it('后台补注册不再绕过邮箱验证码签发云端会话', async () => {
    const { queueCloudRegistration, flush, pendingRegistrationCount } = await loadQueue()
    const { createUser, listUsers, getSession, setSession } = await import('../src/lib/auth')

    const user = await createUser('补注册用户', 'pw1234', 'u_retry01')
    setSession({ userId: user.id, name: user.name })
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })
    await flush()

    expect(pendingRegistrationCount()).toBe(0)
    expect(listUsers().find((u) => u.id === 'u_retry01')?.cloudRegistrationPending).toBeUndefined()
    expect(getSession()?.cloudToken).toBeUndefined()
  })

  it('废弃的后台补注册不会调用旧注册接口', async () => {
    const { queueCloudRegistration, flush, pendingRegistrationCount } = await loadQueue()
    const { createUser, listUsers } = await import('../src/lib/auth')

    const user = await createUser('重名用户', 'pw1234', 'u_taken01')
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })
    await flush()

    expect(pendingRegistrationCount()).toBe(0)
    expect(registerCloud).not.toHaveBeenCalled()
    expect(listUsers().find((u) => u.id === 'u_taken01')?.cloudRegistrationPending).toBeUndefined()
  })

  it('不保留无验证码的后台重试队列', async () => {
    const { queueCloudRegistration, flush, pendingRegistrationCount } = await loadQueue()
    const { createUser, listUsers } = await import('../src/lib/auth')

    const user = await createUser('离线用户', 'pw1234', 'u_off01')
    queueCloudRegistration({ id: user.id, name: user.name, password: 'pw1234' })
    await flush()

    expect(pendingRegistrationCount()).toBe(0)
    expect(listUsers().find((u) => u.id === 'u_off01')?.cloudRegistrationPending).toBeUndefined()
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

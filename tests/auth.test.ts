import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUser, findUserByName, hashHex, listUsers, makeSalt, dataKey, setCloudRegistrationPending } from '../src/lib/auth'

function installStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('本地账号安全', () => {
  it('同一输入哈希一致(可验证密码)', async () => {
    const a = await hashHex('salt1' + 'password123')
    const b = await hashHex('salt1' + 'password123')
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it('不同盐产生不同哈希(防彩虹表)', async () => {
    const a = await hashHex('saltA' + 'password123')
    const b = await hashHex('saltB' + 'password123')
    expect(a).not.toBe(b)
  })

  it('错误密码无法匹配', async () => {
    const salt = makeSalt()
    const stored = await hashHex(salt + 'right')
    const attempt = await hashHex(salt + 'wrong')
    expect(stored).not.toBe(attempt)
  })

  it('盐是 16 位十六进制', () => {
    expect(makeSalt()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('数据键按用户隔离', () => {
    expect(dataKey('u_1')).toBe('zsb_helper_v1__u_1')
    expect(dataKey('u_2')).not.toBe(dataKey('u_1'))
  })

  it('账号查找忽略大小写和首尾空格，待同步标记不保存明文密码', async () => {
    installStorage()
    const user = await createUser(' G1379278332 ', 'secret')
    expect(findUserByName('g1379278332')?.id).toBe(user.id)
    setCloudRegistrationPending(user.id, true)
    const stored = listUsers()[0]
    expect(stored.cloudRegistrationPending).toBe(true)
    expect(stored).not.toHaveProperty('password')
    setCloudRegistrationPending(user.id, false)
    expect(listUsers()[0].cloudRegistrationPending).toBeUndefined()
  })
})

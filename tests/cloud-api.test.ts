import { describe, expect, it, vi } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: rpcMock }),
}))

import { hashPassword, normalizedName, passwordMatches, passwordMatchesAsync, validName, validPassword } from '../server/cloud-api'

describe('云端账号安全', () => {
  it('使用 scrypt 加盐保存和校验密码', () => {
    const { salt, hash } = hashPassword('password123')
    expect(salt).toHaveLength(32)
    expect(passwordMatches('password123', salt, hash)).toBe(true)
    expect(passwordMatches('wrong-password', salt, hash)).toBe(false)
  })

  it('bcrypt 账号通过 service-role RPC 校验,不会误走 scrypt', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test')
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    expect(await passwordMatchesAsync('password123', 'bf', '$2b$08$example')).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('zsb_password_ok', {
      p_password: 'password123',
      p_salt: 'bf',
      p_hash: '$2b$08$example',
    })
  })

  it('bcrypt RPC 返回错误时拒绝密码,旧 scrypt 仍由本地校验', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test')
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    expect(await passwordMatchesAsync('wrong', 'bf', '$2b$08$example')).toBe(false)
    const legacy = hashPassword('password123')
    expect(await passwordMatchesAsync('password123', legacy.salt, legacy.hash)).toBe(true)
  })

  it('标准化账号名并限制账号与密码格式', () => {
    expect(normalizedName(' TestUser ')).toBe('testuser')
    expect(validName('学习')).toBe(true)
    expect(validName('a')).toBe(false)
    expect(validPassword('1234')).toBe(true)
    expect(validPassword('123')).toBe(false)
  })
})

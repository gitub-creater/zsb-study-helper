import { describe, expect, it } from 'vitest'
import { hashPassword, normalizedName, passwordMatches, validName, validPassword } from '../server/cloud-api'

describe('云端账号安全', () => {
  it('使用 scrypt 加盐保存和校验密码', () => {
    const { salt, hash } = hashPassword('password123')
    expect(salt).toHaveLength(32)
    expect(passwordMatches('password123', salt, hash)).toBe(true)
    expect(passwordMatches('wrong-password', salt, hash)).toBe(false)
  })

  it('标准化账号名并限制账号与密码格式', () => {
    expect(normalizedName(' TestUser ')).toBe('testuser')
    expect(validName('学习')).toBe(true)
    expect(validName('a')).toBe(false)
    expect(validPassword('1234')).toBe(true)
    expect(validPassword('123')).toBe(false)
  })
})

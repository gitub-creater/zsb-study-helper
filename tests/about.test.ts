import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/lib/about'

describe('版本号比较', () => {
  it('主/次/修订号比较', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBe(1)
    expect(compareVersions('0.2.1', '0.2.0')).toBe(1)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1)
  })

  it('多位数字与 v 前缀', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('v1.0.0', '0.99.99')).toBe(1)
  })

  it('长度不齐时按 0 补齐', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })
})

// 皮肤取色与对比度检查的测试
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  ensureContrastOnWhite,
  hexToHsl,
  hexToRgb,
  hslToHex,
  readableOn,
  rgbToHex,
  tint,
} from '../src/lib/colorExtract'

describe('颜色工具', () => {
  it('hex/rgb 互转', () => {
    expect(hexToRgb('#FF8040')).toEqual({ r: 255, g: 128, b: 64 })
    expect(rgbToHex(255, 128, 64)).toBe('#ff8040')
  })

  it('黑白对比度为 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })

  it('相同颜色对比度为 1', () => {
    expect(contrastRatio('#3E9BFF', '#3E9BFF')).toBeCloseTo(1, 5)
  })

  it('ensureContrastOnWhite 保证按钮色与白字可读', () => {
    for (const c of ['#FFE08A', '#CCF3E1', '#FFD2D2', '#E6E6E6']) {
      const fixed = ensureContrastOnWhite(c)
      expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
    // 本来就达标的不变色
    expect(ensureContrastOnWhite('#2465B8').toLowerCase()).toBe('#2465b8')
  })

  it('hsl 往返转换误差极小', () => {
    const hex = '#3E9BFF'
    const hsl = hexToHsl(hex)
    const back = hslToHex(hsl.h, hsl.s, hsl.l)
    expect(Math.abs(hexToRgb(back).r - 62)).toBeLessThanOrEqual(2)
    expect(Math.abs(hexToRgb(back).g - 155)).toBeLessThanOrEqual(2)
    expect(Math.abs(hexToRgb(back).b - 255)).toBeLessThanOrEqual(2)
  })

  it('readableOn 在深色底选白字、浅色底选深字', () => {
    expect(readableOn('#101828')).toBe('#ffffff')
    expect(readableOn('#FFF3D6')).toBe('#1f2a37')
  })

  it('tint 变亮变暗', () => {
    expect(tint('#000000', 1)).toBe('#ffffff')
    expect(tint('#ffffff', -1)).toBe('#000000')
  })
})

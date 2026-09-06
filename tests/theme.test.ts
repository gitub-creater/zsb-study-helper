// 主题皮肤逻辑测试:主题回退/可读性检查/背景模块判定/皮肤生成
import { describe, expect, it } from 'vitest'
import { THEMES, THEME_ORDER, asTheme, bgModuleActive, checkSkinReadability, inkOn, skinFromColors, themeSwatch } from '../src/lib/theme'
import { buildPdfFromJpegs } from '../src/lib/pdf'

describe('主题系统', () => {
  it('包含至少 4 套主题,含要求的四类', () => {
    expect(THEME_ORDER.length).toBeGreaterThanOrEqual(4)
    expect(THEMES.freshblue.name).toBe('清爽蓝')
    expect(THEMES.orange.name).toBe('活力橙')
    expect(THEMES.studygreen.name).toBe('学习绿')
    expect(THEMES.dark.name).toBe('深色护眼')
  })

  it('未知主题回退天空蓝', () => {
    expect(asTheme(undefined)).toBe('sky')
    expect(asTheme('hacker-purple')).toBe('sky')
    expect(asTheme('dark')).toBe('dark')
  })

  it('可读性检查:过浅按钮色会被标记', () => {
    const bad = skinFromColors('#FFD7D7', '#EEF3F8', '#FFF5C2', false)
    expect(checkSkinReadability(bad).ok).toBe(false)
    const good = skinFromColors('#2465B8', '#1F7A43', '#B93A2E', false)
    expect(checkSkinReadability(good).ok).toBe(true)
  })

  it('skinFromColors 深色模式提亮主色并保证按钮可读', () => {
    const skin = skinFromColors('#245FA0', '#2FA96E', '#245FA0', true)
    expect(skin.dark).toBe(true)
    expect(skin.opacity).toBeGreaterThan(0.9)
    const check = checkSkinReadability(skin)
    expect(check.ok).toBe(true)
  })

  it('bgModuleActive:未选模块=全局,选了模块按路由匹配', () => {
    expect(bgModuleActive(undefined, 'today')).toBe(true)
    expect(bgModuleActive([], 'bank')).toBe(true)
    expect(bgModuleActive(['home'], 'today')).toBe(true)
    expect(bgModuleActive(['home'], 'bank')).toBe(false)
    expect(bgModuleActive(['study'], 'practice')).toBe(true)
    expect(bgModuleActive(['sidebar'], 'anywhere')).toBe(true)
    expect(bgModuleActive(['login'], 'today')).toBe(false)
  })

  it('主色上的文字颜色总是可读', () => {
    expect(inkOn('#101828')).toBe('#ffffff')
    expect(inkOn('#FFE9C9')).toBe('#1f2a37')
  })

  it('主题色板用于预览卡', () => {
    expect(themeSwatch(THEMES.sky)).toHaveLength(4)
  })
})

describe('极简 PDF 生成器', () => {
  it('生成结构合法的多页 PDF', () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
    const blob = buildPdfFromJpegs([
      { jpeg: fakeJpeg, width: 1920, height: 1080 },
      { jpeg: fakeJpeg, width: 1920, height: 1080 },
    ])
    expect(blob.type).toBe('application/pdf')
    return blob.text().then((text) => {
      expect(text.startsWith('%PDF-1.4')).toBe(true)
      expect(text).toContain('/Count 2')
      expect(text).toContain('/MediaBox [0 0 1920 1080]')
      expect(text).toContain('/Filter /DCTDecode')
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
      expect(text).toContain('/Kids [3 0 R 6 0 R]')
    })
  })
})

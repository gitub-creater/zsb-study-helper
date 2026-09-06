// 主题与头像配置:内置主题 + 自定义皮肤(CSS 变量统一驱动)
// 自定义皮肤支持主色/辅助色/按钮色/圆角/阴影/透明度/深色模式/背景图,
// 全部换算成 :root 上的 CSS 变量,组件层无需感知。
import type { AvatarKind, CustomSkin, SkinModule, SkinVars, ThemeKind } from '../types'
import { contrastRatio, ensureContrastOnWhite, hexToHsl, hexToRgb, hslToHex, readableOn, tint } from './colorExtract'

export interface ThemeDef {
  name: string
  primary: string
  deep: string
  weak: string
  soft: string
  /** 辅助色(徽标/次强调) */
  sec?: string
  /** 深色主题的表面颜色覆盖 */
  surface?: { bg: string; card: string; ink: string; ink2: string; ink3: string; line: string; lineStrong: string }
}

export const THEMES: Record<ThemeKind, ThemeDef> = {
  sky: { name: '天空蓝', primary: '#3E9BFF', deep: '#2465B8', weak: '#E7F2FF', soft: '#CFE5FF', sec: '#2FA96E' },
  mint: { name: '薄荷绿', primary: '#2FB98B', deep: '#1B7A5C', weak: '#E4F6EF', soft: '#C8EBDD', sec: '#3E9BFF' },
  sakura: { name: '樱桃粉', primary: '#F2698C', deep: '#BE3F61', weak: '#FDECF1', soft: '#F9D3DE', sec: '#8B72E8' },
  lemon: { name: '活力黄', primary: '#E89B1C', deep: '#8F5E08', weak: '#FCF3DE', soft: '#F7E3B4', sec: '#F2698C' },
  lavender: { name: '薰衣草', primary: '#8B72E8', deep: '#5F49BC', weak: '#EFECFC', soft: '#DCD5F8', sec: '#F2698C' },
  freshblue: { name: '清爽蓝', primary: '#2BB0ED', deep: '#0C7CB0', weak: '#E4F6FD', soft: '#C6EBFA', sec: '#2FB98B' },
  orange: { name: '活力橙', primary: '#F2762E', deep: '#BC4F0E', weak: '#FDEEE3', soft: '#FAD8C2', sec: '#2FA96E' },
  studygreen: { name: '学习绿', primary: '#3BA35F', deep: '#1F7A43', weak: '#E5F5EA', soft: '#C9E9D4', sec: '#3E9BFF' },
  dark: {
    name: '深色护眼',
    primary: '#5CA9FF',
    deep: '#1E66C0',
    weak: '#152640',
    soft: '#1B3150',
    sec: '#3BBD8A',
    surface: {
      bg: '#0F141C',
      card: '#161D29',
      ink: '#DEE7F2',
      ink2: '#A9B5C4',
      ink3: '#76828F',
      line: '#243044',
      lineStrong: '#324158',
    },
  },
}

export const THEME_ORDER: ThemeKind[] = ['sky', 'mint', 'sakura', 'lemon', 'lavender', 'freshblue', 'orange', 'studygreen', 'dark']

export const AVATAR_INFO: Record<AvatarKind, { name: string; color: string }> = {
  sprout: { name: '芽芽', color: '#8FE3C8' },
  cat: { name: '团团', color: '#FFC069' },
  rabbit: { name: '雪球', color: '#FFB1C6' },
  bear: { name: '布丁', color: '#D8A86F' },
}

export const AVATAR_ORDER: AvatarKind[] = ['sprout', 'cat', 'rabbit', 'bear']

const DARK_SURFACE = THEMES.dark.surface!

/** 归一化主题 key:旧数据/未知值回退天空蓝 */
export function asTheme(v: string | null | undefined): ThemeKind {
  return (THEMES as Record<string, ThemeDef>)[v ?? ''] ? (v as ThemeKind) : 'sky'
}

/** 应用内置主题;深色主题会同时切换全局表面色与 body.theme-dark 类 */
export function applyTheme(theme: ThemeKind): void {
  const t = THEMES[asTheme(theme)]
  const root = document.documentElement.style
  clearSkinVars(root)
  root.setProperty('--primary', t.primary)
  root.setProperty('--primary-deep', t.deep)
  root.setProperty('--primary-weak', t.weak)
  root.setProperty('--primary-soft', t.soft)
  if (t.sec) root.setProperty('--secondary', t.sec)
  // 按钮色默认跟主按钮深色一致,hover 由 JS 计算(避免 color-mix 兼容问题)
  root.setProperty('--btn', t.deep)
  root.setProperty('--btn-hover', tint(t.deep, -0.16))
  root.setProperty('--card-alpha', '1')
  const dark = !!t.surface
  const s = t.surface ?? {
    bg: '#f2f6fb',
    card: '#ffffff',
    ink: '#26313e',
    ink2: '#55616e',
    ink3: '#8792a0',
    line: '#e3eaf2',
    lineStrong: '#cbd6e4',
  }
  root.setProperty('--bg', s.bg)
  root.setProperty('--card', s.card)
  root.setProperty('--ink', s.ink)
  root.setProperty('--ink-2', s.ink2)
  root.setProperty('--ink-3', s.ink3)
  root.setProperty('--line', s.line)
  root.setProperty('--line-strong', s.lineStrong)
  document.body.classList.toggle('theme-dark', dark)
}

function clearSkinVars(root: CSSStyleDeclaration): void {
  const vars = ['--skin-overlay']
  for (const v of vars) root.removeProperty(v)
  document.body.classList.remove('skin-bg')
  document.body.style.removeProperty('background-image')
  document.body.style.removeProperty('background-size')
  document.body.style.removeProperty('background-attachment')
  document.body.style.removeProperty('background-position')
}

/** 深色/浅色底上卡片基色 */
function cardBase(dark: boolean): string {
  return dark ? DARK_SURFACE.card : '#ffffff'
}

function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 应用自定义皮肤:先重置为内置主题,再逐项覆盖,保证缺省字段有安全回退。
 * route 用于"背景图仅应用到指定模块"的判定;空 = 全部应用。
 */
export function applySkin(skin: CustomSkin | null | undefined, builtin: ThemeKind, route?: string): void {
  applyTheme(builtin)
  if (!skin) return
  const root = document.documentElement.style
  const dark = !!skin.dark

  // 主色体系:主色与按钮深色都保证白字可读(WCAG AA)
  const primary = ensureContrastOnWhite(skin.primary, 3)
  const deep = ensureContrastOnWhite(skin.accent || skin.primary, 4.5)
  root.setProperty('--primary', primary)
  root.setProperty('--primary-deep', deep)
  root.setProperty('--btn', deep)
  root.setProperty('--btn-hover', tint(deep, -0.16))
  const ph = hexToHsl(primary)
  if (dark) {
    root.setProperty('--primary-weak', t2(primary, 0.16))
    root.setProperty('--primary-soft', t2(primary, 0.26))
  } else {
    root.setProperty('--primary-weak', tint(primary, 0.9))
    root.setProperty('--primary-soft', tint(primary, 0.76))
  }
  // 辅助色:徽标/次强调,深色下提亮保证可见
  const secondary = dark ? tint(skin.secondary, 0.25) : skin.secondary
  root.setProperty('--secondary', secondary)

  // 圆角 / 阴影 / 卡片透明度
  const radius = Math.min(20, Math.max(0, Math.round(skin.radius)))
  root.setProperty('--r', `${radius}px`)
  root.setProperty('--r-sm', `${Math.max(2, radius - 2)}px`)
  const shadowLevel = Math.min(2, Math.max(0, skin.shadow))
  const shadowMap = [
    'none',
    '0 1px 2px rgba(38, 49, 62, 0.05), 0 2px 10px rgba(38, 49, 62, 0.06)',
    '0 2px 6px rgba(38, 49, 62, 0.10), 0 8px 26px rgba(38, 49, 62, 0.14)',
  ]
  root.setProperty('--shadow', shadowMap[shadowLevel])

  // 卡片不透明度 + 表面色(深色护眼或跟随深色开关)
  const opacity = Math.min(1, Math.max(0.5, skin.opacity))
  root.setProperty('--card-alpha', String(opacity))
  const surfaces = dark
    ? DARK_SURFACE
    : { bg: '#f2f6fb', card: '#ffffff', ink: '#26313e', ink2: '#55616e', ink3: '#8792a0', line: '#e3eaf2', lineStrong: '#cbd6e4' }
  root.setProperty('--bg', surfaces.bg)
  root.setProperty('--card', hexWithAlpha(cardBase(dark), opacity))
  root.setProperty('--ink', surfaces.ink)
  root.setProperty('--ink-2', surfaces.ink2)
  root.setProperty('--ink-3', surfaces.ink3)
  root.setProperty('--line', dark ? surfaces.line : hexWithAlpha(surfaces.line, opacity))
  root.setProperty('--line-strong', surfaces.lineStrong)
  document.body.classList.toggle('theme-dark', dark)

  // 背景图:上面压一层底色渐变保证文字可读(对比度检查的兜底层)
  const bgApplied = !!skin.bgImage && bgModuleActive(skin.bgModules, route)
  document.body.classList.toggle('skin-bg', bgApplied)
  if (bgApplied && skin.bgImage) {
    const overlay = dark ? 'rgba(10, 14, 20, 0.72)' : 'rgba(242, 246, 251, 0.80)'
    document.body.style.backgroundImage = `linear-gradient(${overlay}, ${overlay}), url("${skin.bgImage}")`
    document.body.style.backgroundSize = 'cover'
    document.body.style.backgroundAttachment = 'fixed'
    document.body.style.backgroundPosition = 'center'
  } else {
    document.body.style.removeProperty('background-image')
    document.body.style.removeProperty('background-size')
    document.body.style.removeProperty('background-attachment')
    document.body.style.removeProperty('background-position')
  }
}

function t2(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 背景图应用模块判定:未勾选 = 全局;勾选了 = 当前路由落在所选模块才显示 */
export function bgModuleActive(modules: SkinModule[] | undefined, route?: string): boolean {
  if (!modules || modules.length === 0) return true
  if (!route) return true
  const map: Record<SkinModule, string[]> = {
    login: ['login'],
    home: ['today', 'map', 'pet'],
    sidebar: ['__all__'],
    study: ['bank', 'practice', 'wrong', 'aimath', 'office', 'aioffice', 'english', 'plan', 'scheduled'],
    profile: ['profile', 'settings', 'stats'],
  }
  return modules.some((m) => map[m].includes('__all__') || map[m].includes(route.split('/')[0]))
}

/** 主色上文字的可读色(供皮肤预览/白板笔色选择使用) */
export function inkOn(color: string): string {
  return readableOn(color)
}

/** 皮肤预览小样(主题卡片右上角色板) */
export function themeSwatch(t: ThemeDef): string[] {
  return [t.primary, t.deep, t.sec ?? '#2FA96E', t.soft]
}

/** 检查自定义皮肤配色是否达标(供页面提示与自动修正) */
export function checkSkinReadability(skin: SkinVars): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const cBtn = contrastRatio(ensureContrastOnWhite(skin.accent || skin.primary), '#ffffff')
  if (cBtn < 4.5) issues.push('按钮色与按钮文字对比度不足 4.5:1,已自动加深')
  const cPrimary = contrastRatio(skin.primary, '#ffffff')
  if (cPrimary < 3) issues.push('主色过浅,在白色卡片上可能看不清,已自动加深')
  const cSecondary = contrastRatio(skin.secondary, skin.dark ? '#161d29' : '#ffffff')
  if (cSecondary < 2.5) issues.push('辅助色与背景太接近,已自动调整')
  return { ok: issues.length === 0, issues }
}

/** 从任意颜色生成一套和谐皮肤(手动自定义时的起点) */
export function skinFromColors(primary: string, secondary: string, accent: string, dark: boolean): SkinVars {
  const ph = hexToHsl(primary)
  return {
    primary: dark ? tint(primary, 0.2) : primary,
    secondary,
    accent: ensureContrastOnWhite(accent || primary),
    radius: 8,
    shadow: 1,
    opacity: dark ? 0.96 : 1,
    dark,
    bgModules: [],
  }
}

export function hslHelper(h: number, s: number, l: number): string {
  return hslToHex(h, s, l)
}

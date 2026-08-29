// 主题与头像配置
import type { AvatarKind, ThemeKind } from '../types'

export interface ThemeDef {
  name: string
  primary: string
  deep: string
  weak: string
  soft: string
}

export const THEMES: Record<ThemeKind, ThemeDef> = {
  sky: { name: '天空蓝', primary: '#3E9BFF', deep: '#2465B8', weak: '#E7F2FF', soft: '#CFE5FF' },
  mint: { name: '薄荷绿', primary: '#2FB98B', deep: '#1B7A5C', weak: '#E4F6EF', soft: '#C8EBDD' },
  sakura: { name: '樱桃粉', primary: '#F2698C', deep: '#BE3F61', weak: '#FDECF1', soft: '#F9D3DE' },
  lemon: { name: '活力黄', primary: '#E89B1C', deep: '#8F5E08', weak: '#FCF3DE', soft: '#F7E3B4' },
  lavender: { name: '薰衣草', primary: '#8B72E8', deep: '#5F49BC', weak: '#EFECFC', soft: '#DCD5F8' },
}

export const THEME_ORDER: ThemeKind[] = ['sky', 'mint', 'sakura', 'lemon', 'lavender']

export const AVATAR_INFO: Record<AvatarKind, { name: string; color: string }> = {
  sprout: { name: '芽芽', color: '#8FE3C8' },
  cat: { name: '团团', color: '#FFC069' },
  rabbit: { name: '雪球', color: '#FFB1C6' },
  bear: { name: '布丁', color: '#D8A86F' },
}

export const AVATAR_ORDER: AvatarKind[] = ['sprout', 'cat', 'rabbit', 'bear']

export function applyTheme(theme: ThemeKind): void {
  const t = THEMES[theme] ?? THEMES.sky
  const root = document.documentElement.style
  root.setProperty('--primary', t.primary)
  root.setProperty('--primary-deep', t.deep)
  root.setProperty('--primary-weak', t.weak)
  root.setProperty('--primary-soft', t.soft)
}

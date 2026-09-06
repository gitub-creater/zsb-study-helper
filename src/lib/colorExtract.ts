// 皮肤图片处理:格式/大小校验、压缩存储、主色提取(直方图量化)、对比度检查
// 全部在浏览器 canvas 完成,不依赖第三方库;失败时调用方回退默认主题

import type { SkinVars } from '../types'

export const SKIN_IMAGE_RULES = {
  types: ['image/jpeg', 'image/png', 'image/webp'],
  typeText: 'JPG、PNG、WEBP',
  maxSize: 5 * 1024 * 1024,
  maxSizeText: '5MB',
  suggestSizeText: '1920×1080 或更高',
  suggestRatio: '16:9',
} as const

export interface HexColor {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): HexColor {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full.slice(0, 6), 16)
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const f = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

/** WCAG 相对亮度 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 对比度(1-21) */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = Math.min(1, Math.max(0, s))
  l = Math.min(1, Math.max(0, l))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return { h, s, l }
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHsl(r, g, b)
}

/** 混入白色(t>0 变亮)/黑色(t<0 变暗) */
export function tint(hex: string, t: number): string {
  const { r, g, b } = hexToRgb(hex)
  const target = t >= 0 ? 255 : 0
  const k = Math.abs(t)
  return rgbToHex(r + (target - r) * k, g + (target - g) * k, b + (target - b) * k)
}

/**
 * 从图片提取皮肤配色:主色(出现最多的高饱和色)、辅助色(色相距离远的第二主色)、
 * 强调色/按钮色(保证与白字对比度 ≥ 4.5)。
 */
export function extractPalette(canvas: HTMLCanvasElement): { primary: string; secondary: string; accent: string; dark: boolean } {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { primary: '#3E9BFF', secondary: '#2FA96E', accent: '#2465B8', dark: false }
  const w = canvas.width
  const h = canvas.height
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 12000)))
  const data = ctx.getImageData(0, 0, w, h).data
  // 32 级/通道量化直方图,同时统计整体明暗
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let brightSum = 0
  let n = 0
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      if (a < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      brightSum += 0.2126 * r + 0.7152 * g + 0.0722 * b
      n++
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
      cur.count++
      cur.r += r
      cur.g += g
      cur.b += b
      buckets.set(key, cur)
    }
  }
  const dark = n > 0 && brightSum / n < 100
  const ranked = [...buckets.values()]
    .map((v) => {
      const r = v.r / v.count
      const g = v.g / v.count
      const b = v.b / v.count
      const hsl = rgbToHsl(r, g, b)
      // 排除近白/近黑的“无色彩”大块,但保留其占比信息用于兜底
      const colorful = hsl.s > 0.18 && hsl.l > 0.12 && hsl.l < 0.88
      return { hex: rgbToHex(r, g, b), hsl, count: v.count, colorful }
    })
    .sort((a, b) => b.count - a.count)

  const primaryPick = ranked.find((c) => c.colorful) ?? ranked[0] ?? { hex: '#3E9BFF', hsl: { h: 210, s: 1, l: 0.62 }, count: 0, colorful: true }
  let primary = primaryPick.hex
  // 主色保证饱和度下限,避免灰蒙蒙
  {
    const hsl = hexToHsl(primary)
    primary = hslToHex(hsl.h, Math.max(hsl.s, 0.45), Math.min(0.62, Math.max(0.4, hsl.l)))
  }
  // 辅助色:与主色色相差 ≥ 60° 的最高占比彩色
  const pHsl = hexToHsl(primary)
  const secondaryPick =
    ranked.find((c) => c.colorful && c.hex !== primary && hueDist(c.hsl.h, pHsl.h) >= 60) ??
    ranked.find((c) => c.colorful && c.hex !== primary)
  let secondary = secondaryPick?.hex
  if (!secondary) secondary = hslToHex(pHsl.h + 150, Math.max(0.5, pHsl.s), Math.min(0.55, Math.max(0.35, pHsl.l)))
  else {
    const hsl = hexToHsl(secondary)
    secondary = hslToHex(hsl.h, Math.max(hsl.s, 0.4), Math.min(0.55, Math.max(0.32, hsl.l)))
  }
  // 按钮色:主色加深到与白字对比度达标
  const accent = ensureContrastOnWhite(primary)
  return { primary, secondary, accent, dark }
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360)
  return d > 180 ? 360 - d : d
}

/** 调暗到白字对比度 ≥ 4.5(WCAG AA) */
export function ensureContrastOnWhite(color: string, min = 4.5): string {
  let cur = color
  for (let i = 0; i < 24 && contrastRatio(cur, '#ffffff') < min; i++) {
    const hsl = hexToHsl(cur)
    cur = hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - 0.04))
  }
  return cur
}

/** 文字颜色在背景上的可读性:必要时在黑白之间切换 */
export function readableOn(color: string): '#ffffff' | '#1f2a37' {
  return contrastRatio(color, '#ffffff') >= contrastRatio(color, '#1f2a37') ? '#ffffff' : '#1f2a37'
}

export interface SkinImageResult {
  /** 压缩后的 dataURL(用于存储,最长边 1600) */
  dataUrl: string
  /** 压缩前原始像素尺寸 */
  width: number
  height: number
  palette: { primary: string; secondary: string; accent: string; dark: boolean }
}

/**
 * 校验并处理上传的皮肤图片:
 * 1) 类型必须为 JPG/PNG/WEBP,大小 ≤ 5MB;
 * 2) 压缩到最长边 1600(localStorage 配额友好),JPEG 质量 0.8;
 * 3) 提取主色/辅助色/强调色;
 * 4) 自动推导文字/边框/背景透明度调整(返回 SkinVars)。
 * 校验失败抛出中文错误,由调用方 toast。
 */
export async function processSkinImage(file: File): Promise<SkinImageResult> {
  if (!(SKIN_IMAGE_RULES.types as readonly string[]).includes(file.type)) {
    throw new Error(`仅支持 ${SKIN_IMAGE_RULES.typeText} 格式,当前是 ${file.type || '未知类型'}`)
  }
  if (file.size > SKIN_IMAGE_RULES.maxSize) {
    throw new Error(`图片不能超过 ${SKIN_IMAGE_RULES.maxSizeText},当前 ${(file.size / 1024 / 1024).toFixed(1)}MB`)
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持图片处理')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const palette = extractPalette(canvas)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight, palette }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片读取失败,文件可能已损坏'))
    img.src = src
  })
}

/** 由图片配色推导完整皮肤参数(含透明度/阴影的自动调整) */
export function skinVarsFromPalette(
  palette: { primary: string; secondary: string; accent: string; dark: boolean },
  bgImage: string
): SkinVars {
  return {
    primary: palette.primary,
    secondary: palette.secondary,
    accent: palette.accent,
    radius: 8,
    shadow: 1,
    // 图片背景上卡片半透明,保证图能透出来同时文字可读
    opacity: 0.88,
    dark: palette.dark,
    bgImage,
    bgModules: [],
  }
}

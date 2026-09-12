// 讲题白板(希沃式 + 无限画布):画笔/荧光笔/橡皮/选择移动/直线/矩形/圆/箭头/文本
// + 撤销恢复清空 + 题目图片 + 方格/横线底纹 + 全屏讲课 + 导出
// 无限画布:所有元素存"世界坐标"(单位=一个视口宽/高),按住手型工具/中键拖动即可
// 朝任意方向平移,想移多远移多远;滚轮上下平移(Shift+滚轮左右)。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardItem, BoardPage } from '../types'
import { Icon } from './Icon'
import { uid } from '../lib/misc'
import { processSkinImage } from '../lib/colorExtract'

export type BoardTool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle' | 'arrow' | 'text' | 'highlight' | 'select' | 'hand'

interface Pan {
  x: number
  y: number
}

const TOOL_META: { key: BoardTool; label: string; icon: React.ReactNode }[] = [
  { key: 'pen', label: '画笔', icon: <Icon name="edit" size={15} /> },
  { key: 'highlight', label: '荧光笔', icon: <Icon name="sparkle" size={15} /> },
  { key: 'eraser', label: '橡皮擦(局部擦除)', icon: <span className="wb-eraser-ico" aria-hidden /> },
  { key: 'select', label: '选择/移动', icon: <span className="wb-select-ico" aria-hidden /> },
  { key: 'hand', label: '手型:按住拖动,画板无限大', icon: <span className="wb-hand-ico" aria-hidden /> },
  { key: 'line', label: '直线(Shift 吸附 15°)', icon: <span className="wb-line-ico" aria-hidden /> },
  { key: 'rect', label: '矩形(Shift 正方形)', icon: <span className="wb-rect-ico" aria-hidden /> },
  { key: 'circle', label: '圆形(Shift 正圆)', icon: <span className="wb-circle-ico" aria-hidden /> },
  { key: 'arrow', label: '箭头', icon: <span className="wb-arrow-ico" aria-hidden /> },
  { key: 'text', label: '文本(双击已写文字可改)', icon: <b style={{ fontSize: 13 }}>T</b> },
]

const PEN_COLORS = ['#26313e', '#e85d4f', '#2fa96e', '#3e9bff', '#e89b1c', '#8b72e8']

/** 世界坐标 → 屏幕像素 */
function sx(world: number, pan: Pan, w: number): number {
  return (world - pan.x) * w
}
function sy(world: number, pan: Pan, h: number): number {
  return (world - pan.y) * h
}

/** 把一页白板渲染到画布(世界坐标 + 视口平移);导出时传入大画布与对应 pan */
export function drawBoard(ctx: CanvasRenderingContext2D, page: BoardPage, w: number, h: number, pan: Pan, bg?: string): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = bg ?? '#ffffff'
  ctx.fillRect(0, 0, w, h)
  if (page.bgImage) {
    const img = bgImageCache.get(page.bgImage)
    if (img?.complete) ctx.drawImage(img, sx(0, pan, w), sy(0, pan, h), w, h)
  }
  if (page.grid) {
    ctx.save()
    ctx.strokeStyle = page.grid === 'grid' ? 'rgba(94, 148, 255, 0.22)' : 'rgba(94, 148, 255, 0.30)'
    ctx.lineWidth = 1
    if (page.grid === 'grid') {
      const step = 1 / 24
      for (let k = Math.ceil(pan.x / step); sx(k * step, pan, w) <= w; k++) {
        ctx.beginPath()
        ctx.moveTo(sx(k * step, pan, w), 0)
        ctx.lineTo(sx(k * step, pan, w), h)
        ctx.stroke()
      }
      const stepY = 1 / 10
      for (let k = Math.ceil(pan.y / stepY); sy(k * stepY, pan, h) <= h; k++) {
        ctx.beginPath()
        ctx.moveTo(0, sy(k * stepY, pan, h))
        ctx.lineTo(w, sy(k * stepY, pan, h))
        ctx.stroke()
      }
    } else {
      const stepY = 1 / 10
      for (let k = Math.ceil(pan.y / stepY); sy(k * stepY, pan, h) <= h; k++) {
        ctx.beginPath()
        ctx.moveTo(0, sy(k * stepY, pan, h))
        ctx.lineTo(w, sy(k * stepY, pan, h))
        ctx.stroke()
      }
    }
    ctx.restore()
  }
  for (const item of page.items) drawItem(ctx, item, w, h, pan)
}

function drawItemBase(ctx: CanvasRenderingContext2D, item: BoardItem, w: number, h: number, pan: Pan): void {
  const px = (n: number) => sx(n, pan, w)
  const py = (n: number) => sy(n, pan, h)
  // 笔迹宽度:滑杆值按 1080p 基准等比缩放(直接乘 h 会把 3px 变成上千px)
  const lw = Math.max(1.2, (item.width * h) / 1080)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.globalAlpha = item.type === 'highlight' ? 0.32 : 1
  ctx.lineWidth = item.type === 'highlight' ? lw * 4 : lw
  switch (item.type) {
    case 'pen':
    case 'highlight': {
      const pts = item.pts
      if (pts.length < 4) {
        ctx.beginPath()
        ctx.arc(px(pts[0]), py(pts[1]), ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      // 希沃式顺滑笔迹:二次贝塞尔过中点
      ctx.beginPath()
      ctx.moveTo(px(pts[0]), py(pts[1]))
      if (pts.length === 4) {
        ctx.lineTo(px(pts[2]), py(pts[3]))
      } else {
        let i = 2
        for (; i < pts.length - 3; i += 2) {
          const xc = (px(pts[i]) + px(pts[i + 2])) / 2
          const yc = (py(pts[i + 1]) + py(pts[i + 3])) / 2
          ctx.quadraticCurveTo(px(pts[i]), py(pts[i + 1]), xc, yc)
        }
        ctx.quadraticCurveTo(px(pts[i]), py(pts[i + 1]), px(pts[pts.length - 2]), py(pts[pts.length - 1]))
      }
      ctx.stroke()
      break
    }
    case 'line':
      ctx.beginPath()
      ctx.moveTo(px(item.pts[0]), py(item.pts[1]))
      ctx.lineTo(px(item.pts[2]), py(item.pts[3]))
      ctx.stroke()
      break
    case 'arrow': {
      const [x0, y0, x1, y1] = item.pts
      ctx.beginPath()
      ctx.moveTo(px(x0), py(y0))
      ctx.lineTo(px(x1), py(y1))
      ctx.stroke()
      const ang = Math.atan2(py(y1) - py(y0), px(x1) - px(x0))
      const head = Math.max(10, lw * 3)
      ctx.beginPath()
      ctx.moveTo(px(x1), py(y1))
      ctx.lineTo(px(x1) - head * Math.cos(ang - 0.45), py(y1) - head * Math.sin(ang - 0.45))
      ctx.lineTo(px(x1) - head * Math.cos(ang + 0.45), py(y1) - head * Math.sin(ang + 0.45))
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'rect':
      ctx.strokeRect(Math.min(px(item.pts[0]), px(item.pts[2])), Math.min(py(item.pts[1]), py(item.pts[3])), Math.abs(px(item.pts[2]) - px(item.pts[0])), Math.abs(py(item.pts[3]) - py(item.pts[1])))
      break
    case 'circle':
      ctx.beginPath()
      ctx.ellipse((px(item.pts[0]) + px(item.pts[2])) / 2, (py(item.pts[1]) + py(item.pts[3])) / 2, Math.abs(px(item.pts[2]) - px(item.pts[0])) / 2, Math.abs(py(item.pts[3]) - py(item.pts[1])) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'text': {
      const fontSize = Math.max(12, item.width * h)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textBaseline = 'top'
      const lines = (item.text ?? '').split('\n')
      lines.forEach((line, i) => ctx.fillText(line, px(item.pts[0]), py(item.pts[1]) + i * fontSize * 1.25))
      break
    }
    case 'image': {
      const src = item.src
      if (!src) break
      const img = bgImageCache.get(src)
      if (img?.complete) ctx.drawImage(img, px(item.pts[0]), py(item.pts[1]), px(item.pts[2]) - px(item.pts[0]), py(item.pts[3]) - py(item.pts[1]))
      break
    }
  }
  ctx.restore()
}

/** 绘制单个对象并仅从该对象自身抠除擦除点,不影响下方对象。 */
export function drawItem(ctx: CanvasRenderingContext2D, item: BoardItem, w: number, h: number, pan: Pan): void {
  if (!item.erasePoints?.length) {
    drawItemBase(ctx, item, w, h, pan)
    return
  }
  const layer = document.createElement('canvas')
  layer.width = Math.max(1, Math.ceil(w * (window.devicePixelRatio || 1)))
  layer.height = Math.max(1, Math.ceil(h * (window.devicePixelRatio || 1)))
  const layerCtx = layer.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawItemBase(layerCtx, { ...item, erasePoints: undefined }, w, h, pan)
  layerCtx.save()
  layerCtx.globalCompositeOperation = 'destination-out'
  for (const ep of item.erasePoints) {
    layerCtx.beginPath()
    const cx = sx(ep.x, pan, w)
    const cy = sy(ep.y, pan, h)
    const rx = Math.max(1.5, (ep.rx ?? ep.r) * w)
    const ry = Math.max(1.5, (ep.ry ?? ep.r) * h)
    layerCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    layerCtx.fill()
  }
  layerCtx.restore()
  ctx.drawImage(layer, 0, 0, w, h)
}

const bgImageCache = new Map<string, HTMLImageElement>()

export function prefetchBoardImage(src: string, onReady?: () => void): void {
  if (bgImageCache.has(src)) return
  const img = new Image()
  img.onload = () => onReady?.()
  img.src = src
  bgImageCache.set(src, img)
}

/** 点到线段的世界坐标距离。 */
function pointSegmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

type EraserRadius = number | { x: number; y: number }

function radiusValues(radius: EraserRadius): { x: number; y: number } {
  return typeof radius === 'number' ? { x: radius, y: radius } : radius
}

function pointTextContains(item: BoardItem, p: { x: number; y: number }, radius: EraserRadius): boolean {
  const lines = (item.text ?? '').split('\n')
  const width = Math.max(0.08, Math.max(...lines.map((line) => line.length), 1) * item.width * 0.62)
  const height = Math.max(0.06, lines.length * item.width * 1.3)
  const radii = radiusValues(radius)
  return p.x >= item.pts[0] - radii.x && p.x <= item.pts[0] + width + radii.x && p.y >= item.pts[1] - radii.y && p.y <= item.pts[1] + height + radii.y
}

/** 按实际笔迹/图形轮廓判断橡皮擦是否碰到对象,而不是只命中整块包围盒。 */
export function boardItemContainsPoint(item: BoardItem, p: { x: number; y: number }, radius: EraserRadius = 0.02): boolean {
  if (item.type === 'image' || item.pts.length < 2) return false
  const radii = radiusValues(radius)
  const hitRadius = Math.max(radii.x, radii.y)
  if (item.type === 'text') return pointTextContains(item, p, hitRadius)
  const strokeRadius = Math.max(0.001, item.width / 1080)
  const threshold = hitRadius + strokeRadius
  const point = (idx: number) => ({ x: item.pts[idx], y: item.pts[idx + 1] })
  if (item.type === 'pen' || item.type === 'highlight') {
    for (let i = 0; i + 3 < item.pts.length; i += 2) {
      if (pointSegmentDistance(p, point(i), point(i + 2)) <= threshold) return true
    }
    return pointSegmentDistance(p, point(0), point(0)) <= threshold
  }
  if (item.type === 'line' || item.type === 'arrow') return pointSegmentDistance(p, point(0), point(2)) <= threshold
  if (item.type === 'rect') {
    const x0 = Math.min(item.pts[0], item.pts[2])
    const x1 = Math.max(item.pts[0], item.pts[2])
    const y0 = Math.min(item.pts[1], item.pts[3])
    const y1 = Math.max(item.pts[1], item.pts[3])
    const edges = [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]]
    return edges.some(([a, b]) => pointSegmentDistance(p, a, b) <= threshold)
  }
  if (item.type === 'circle') {
    const cx = (item.pts[0] + item.pts[2]) / 2
    const cy = (item.pts[1] + item.pts[3]) / 2
    const rx = Math.abs(item.pts[2] - item.pts[0]) / 2
    const ry = Math.abs(item.pts[3] - item.pts[1]) / 2
    if (rx === 0 || ry === 0) return Math.hypot(p.x - cx, p.y - cy) <= threshold
    const normalized = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    return Math.abs(normalized - 1) * Math.min(rx, ry) <= threshold
  }
  return false
}

/** 橡皮擦一次命中的对象,返回带局部擦除点的新对象数组。 */
export function eraseBoardItemsAt(
  items: BoardItem[],
  p: { x: number; y: number },
  radius: EraserRadius = 0.02,
  previous?: { x: number; y: number },
): { items: BoardItem[]; hitIds: string[] } {
  const radii = radiusValues(radius)
  const distance = previous ? Math.hypot(p.x - previous.x, p.y - previous.y) : 0
  const steps = Math.max(1, Math.ceil(distance / Math.max(Math.max(radii.x, radii.y) * 0.55, 0.001)))
  const samples = previous
    ? Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps
        return { x: previous.x + (p.x - previous.x) * t, y: previous.y + (p.y - previous.y) * t }
      })
    : [p]
  const hitIds = items.filter((item) => samples.some((sample) => boardItemContainsPoint(item, sample, radius))).map((item) => item.id)
  if (hitIds.length === 0) return { items, hitIds }
  const hitSet = new Set(hitIds)
  const next = items.map((item) => {
    if (!hitSet.has(item.id)) return item
    const newPoints = samples.filter((sample) => boardItemContainsPoint(item, sample, radius)).map((sample) => ({ ...sample, r: Math.max(radii.x, radii.y), rx: radii.x, ry: radii.y }))
    return newPoints.length ? { ...item, erasePoints: [...(item.erasePoints ?? []), ...newPoints] } : item
  })
  return { items: next, hitIds }
}

/** 选中项的虚线框(希沃式) */
function drawSelectionBox(ctx: CanvasRenderingContext2D, item: BoardItem, w: number, h: number, pan: Pan): void {
  const xs = item.pts.filter((_, idx) => idx % 2 === 0)
  const ys = item.pts.filter((_, idx) => idx % 2 === 1)
  const pad = 0.012
  const x0 = sx(Math.min(...xs) - pad, pan, w)
  const y0 = sy(Math.min(...ys) - pad, pan, h)
  const bw = (Math.max(...xs) - Math.min(...xs) + pad * 2) * w
  const bh = (Math.max(...ys) - Math.min(...ys) + pad * 2) * h
  ctx.save()
  ctx.strokeStyle = '#3e9bff'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.strokeRect(x0, y0, Math.max(bw, 18), Math.max(bh, 18))
  ctx.restore()
}

/** 内容包围盒(世界坐标;无内容时为一屏) */
export function pageBounds(page: BoardPage): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = 0
  let y0 = 0
  let x1 = 1
  let y1 = 1
  for (const it of page.items) {
    const xs = it.pts.filter((_, idx) => idx % 2 === 0)
    const ys = it.pts.filter((_, idx) => idx % 2 === 1)
    if (xs.length) {
      x0 = Math.min(x0, Math.min(...xs) - 0.05)
      x1 = Math.max(x1, Math.max(...xs) + 0.05)
    }
    if (ys.length) {
      y0 = Math.min(y0, Math.min(...ys) - 0.05)
      y1 = Math.max(y1, Math.max(...ys) + 0.05)
    }
  }
  return { x0, y0, x1, y1 }
}

/** 渲染一页到离屏画布(导出 PNG/PDF 用;范围=内容包围盒,单轴最多 6 屏) */
export async function renderPageToCanvas(page: BoardPage): Promise<HTMLCanvasElement> {
  if (page.bgImage) prefetchBoardImage(page.bgImage)
  const pending = page.items.filter((i) => i.src && !bgImageCache.get(i.src)?.complete).map((i) => prefetchBoardImage(i.src!))
  await Promise.all(pending.map((p) => new Promise<void>((r) => setTimeout(r, 80))))
  const b = pageBounds(page)
  const spanX = Math.min(6, Math.max(0.2, b.x1 - b.x0))
  const spanY = Math.min(6, Math.max(0.2, b.y1 - b.y0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(1920 * spanX)
  canvas.height = Math.round(1080 * spanY)
  const ctx = canvas.getContext('2d')!
  drawBoard(ctx, page, canvas.width, canvas.height, { x: b.x0, y: b.y0 })
  return canvas
}

interface WhiteboardProps {
  page: BoardPage
  canEdit: boolean
  lockNote?: string
  onAddItems: (items: BoardItem[]) => void
  onReplaceItems: (items: BoardItem[]) => void
  onSetBg: (dataUrl?: string) => void
  onSetGrid?: (grid: 'grid' | 'lines' | undefined) => void
}

export function Whiteboard({ page, canEdit, lockNote, onAddItems, onReplaceItems, onSetBg, onSetGrid }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<BoardTool>('pen')
  const [color, setColor] = useState(PEN_COLORS[0])
  const [lineW, setLineW] = useState(3)
  const [preview, setPreview] = useState<BoardItem | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string; editingId?: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragItem, setDragItem] = useState<BoardItem | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const drawing = useRef(false)
  /** 笔迹缓冲用 ref 提交,避免 React 状态时序丢笔 */
  const strokeRef = useRef<BoardItem | null>(null)
  const startW = useRef<{ x: number; y: number } | null>(null)
  const panDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const dragOrigin = useRef<{ item: BoardItem; x: number; y: number } | null>(null)
  const undoStack = useRef<BoardItem[][]>([])
  const redoStack = useRef<BoardItem[][]>([])
  const eraserCursorRef = useRef<HTMLDivElement>(null)
  const eraserLastPoint = useRef<{ x: number; y: number } | null>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const bgInput = useRef<HTMLInputElement>(null)
  const pageRef = useRef(page)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const items = page.items.map((i) => (dragItem && i.id === dragItem.id ? dragItem : i))
    const eff: BoardPage = preview ? { ...page, items: [...items, preview] } : { ...page, items }
    // 白底:'transparent' 不是合法 fillStyle,会让画布保持默认黑色
    drawBoard(ctx, eff, rect.width, rect.height, pan, '#ffffff')
    const sel = selectedId ?? dragItem?.id
    const target = items.find((i) => i.id === sel)
    if (target) drawSelectionBox(ctx, target, rect.width, rect.height, pan)
  }, [page, preview, selectedId, dragItem, pan])

  useEffect(() => {
    redraw()
  }, [redraw])

  useEffect(() => {
    if (page.bgImage) prefetchBoardImage(page.bgImage, redraw)
    page.items.filter((i) => i.src).forEach((i) => prefetchBoardImage(i.src!, redraw))
    const ro = new ResizeObserver(() => redraw())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [page, redraw])

  // 滚轮平移无限画布(挂 window 用捕获匹配,避免局部节点替换后监听丢失;非 passive 可阻止页面滚动)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const wrap = wrapRef.current
      if (!wrap || !wrap.contains(e.target as Node)) return
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      if (e.shiftKey) setPan((p) => ({ ...p, x: p.x + e.deltaY / rect.width }))
      else setPan((p) => ({ ...p, y: p.y + e.deltaY / rect.height, x: p.x + e.deltaX / rect.width }))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // 全屏状态同步
  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  const toWorld = (e: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: pan.x + (e.clientX - rect.left) / rect.width,
      y: pan.y + (e.clientY - rect.top) / rect.height,
    }
  }

  /** 命中测试:返回最上层(数组末尾)的包含点 */
  function hitTest(p: { x: number; y: number }): BoardItem | null {
    for (let i = page.items.length - 1; i >= 0; i--) {
      if (boardItemContainsPoint(page.items[i], p, 0.015)) return page.items[i]
    }
    return null
  }

  function onPointerDown(e: React.PointerEvent) {
    if (textInput) return
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
    // 手型工具 / 中键:按住拖动平移,任意方向、无限远
    if (tool === 'hand' || e.button === 1) {
      panDrag.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y }
      setPanning(true)
      drawing.current = true
      return
    }
    if (!canEdit) return
    const p = toWorld(e)
    if (tool === 'select') {
      const hit = hitTest(p)
      if (hit) {
        setSelectedId(hit.id)
        dragOrigin.current = { item: hit, x: p.x, y: p.y }
        drawing.current = true
      } else {
        setSelectedId(null)
      }
      return
    }
    if (tool === 'eraser') {
      pushUndo()
      drawing.current = true
      eraserLastPoint.current = null
      eraseAt(p)
      return
    }
    if (tool === 'text') {
      setTextInput({ x: p.x, y: p.y, value: '' })
      return
    }
    pushUndo()
    drawing.current = true
    startW.current = p
    if (tool === 'pen' || tool === 'highlight') {
      const s: BoardItem = {
        id: uid('bi'),
        type: tool,
        pts: [p.x, p.y, p.x + 0.001, p.y + 0.001],
        color: tool === 'highlight' ? '#ffe066' : color,
        width: tool === 'highlight' ? lineW + 4 : lineW,
        by: 'me',
        at: Date.now(),
      }
      strokeRef.current = s
      setPreview(s)
    }
  }

  function eraseAt(p: { x: number; y: number }) {
    const currentPage = pageRef.current
    const rect = canvasRef.current?.getBoundingClientRect()
    // 光圈直径为 34px,换算成世界坐标后保证“看到哪里擦哪里”。
    const radius = rect ? { x: Math.max(0.01, 17 / rect.width), y: Math.max(0.01, 17 / rect.height) } : 0.02
    const result = eraseBoardItemsAt(currentPage.items, p, radius, eraserLastPoint.current ?? undefined)
    eraserLastPoint.current = p
    if (result.hitIds.length === 0) return
    const nextPage = { ...currentPage, items: result.items }
    pageRef.current = nextPage
    onReplaceItems(result.items)
  }

  function onPointerMove(e: React.PointerEvent) {
    moveEraserCursor(e)
    // 平移中:内容跟随手指/鼠标
    if (panDrag.current) {
      const rect = wrapRef.current!.getBoundingClientRect()
      const d = panDrag.current
      setPan({ x: d.ox - (e.clientX - d.sx) / rect.width, y: d.oy - (e.clientY - d.sy) / rect.height })
      return
    }
    if (!drawing.current || !canEdit) return
    const p = toWorld(e)
    if (tool === 'select' && dragOrigin.current) {
      const { item, x, y } = dragOrigin.current
      const dx = p.x - x
      const dy = p.y - y
      const moved: BoardItem = {
        ...item,
        pts: item.pts.map((v, idx) => (idx % 2 === 0 ? v + dx : v + dy)),
        erasePoints: item.erasePoints?.map((ep) => ({ ...ep, x: ep.x + dx, y: ep.y + dy })),
      }
      setDragItem(moved)
      return
    }
    if (tool === 'eraser') {
      eraseAt(p)
      return
    }
    if ((tool === 'pen' || tool === 'highlight') && strokeRef.current) {
      const s = strokeRef.current
      const last = s.pts.length
      const dx = p.x - s.pts[last - 2]
      const dy = p.y - s.pts[last - 1]
      if (dx * dx + dy * dy > 0.00002) {
        const next: BoardItem = { ...s, pts: [...s.pts, p.x, p.y] }
        strokeRef.current = next
        setPreview(next)
      }
      return
    }
    if (startW.current) {
      const s = startW.current
      let ex = p.x
      let ey = p.y
      // Shift 约束:直线/箭头吸附 15°;矩形/圆等比
      if (e.shiftKey) {
        const rect = canvasRef.current!.getBoundingClientRect()
        if (tool === 'line' || tool === 'arrow') {
          const dxPx = (ex - s.x) * rect.width
          const dyPx = (ey - s.y) * rect.height
          const ang = Math.atan2(dyPx, dxPx)
          const snapped = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
          const len = Math.hypot(dxPx, dyPx)
          ex = s.x + (len * Math.cos(snapped)) / rect.width
          ey = s.y + (len * Math.sin(snapped)) / rect.height
        } else if (tool === 'rect' || tool === 'circle') {
          const wPx = Math.abs(ex - s.x) * rect.width
          const hPx = Math.abs(ey - s.y) * rect.height
          const side = Math.max(wPx, hPx)
          ex = s.x + Math.sign(ex - s.x || 1) * (side / rect.width)
          ey = s.y + Math.sign(ey - s.y || 1) * (side / rect.height)
        }
      }
      setPreview({ id: 'preview', type: tool as 'line' | 'rect' | 'circle' | 'arrow', pts: [s.x, s.y, ex, ey], color, width: lineW, by: 'me', at: Date.now() })
    }
  }

  function onPointerUp(e?: React.PointerEvent) {
    // 结束平移
    if (panDrag.current) {
      panDrag.current = null
      setPanning(false)
      drawing.current = false
      return
    }
    if (!drawing.current) return
    drawing.current = false
    eraserLastPoint.current = null
    startW.current = null
    // 选择拖动:提交移动(ref 为准,不吃状态时序亏)
    if (tool === 'select' && dragOrigin.current) {
      const origin = dragOrigin.current.item
      dragOrigin.current = null
      setDragItem((cur) => {
        if (cur) {
          const movedPts = cur.pts.some((v, idx) => Math.abs(v - origin.pts[idx]) > 0.001)
          if (movedPts) {
            pushUndo()
            onReplaceItems(page.items.map((i) => (i.id === cur.id ? cur : i)))
          }
        }
        return null
      })
      return
    }
    // 笔迹提交:ref 为准
    if (strokeRef.current) {
      const s = strokeRef.current
      strokeRef.current = null
      setPreview(null)
      onAddItems([s])
      return
    }
    // 形状:用最后的 preview 状态(ref 不缓冲形状)
    if (preview && preview.id === 'preview' && ['line', 'rect', 'circle', 'arrow'].includes(preview.type)) {
      const dx = preview.pts[2] - preview.pts[0]
      const dy = preview.pts[3] - preview.pts[1]
      if (dx * dx + dy * dy > 0.0002) onAddItems([{ ...preview, id: uid('bi') }])
    }
    setPreview(null)
    void e
  }

  function commitText() {
    if (!textInput) return
    const value = textInput.value.trim()
    if (value && textInput.editingId) {
      pushUndo()
      onReplaceItems(page.items.map((i) => (i.id === textInput.editingId ? { ...i, text: value } : i)))
    } else if (value) {
      pushUndo()
      onAddItems([
        { id: uid('bi'), type: 'text', pts: [textInput.x, textInput.y], color, width: Math.max(0.02, lineW / 80), text: value, by: 'me', at: Date.now() },
      ])
    }
    setTextInput(null)
  }

  /** 双击文字元素直接再编辑(希沃式对象化) */
  function onDoubleClickText(e: React.MouseEvent) {
    if (!canEdit) return
    const hit = hitTest(toWorld(e))
    if (hit?.type === 'text') {
      setTextInput({ x: hit.pts[0], y: hit.pts[1], value: hit.text ?? '', editingId: hit.id })
    }
  }

  /** 橡皮光圈跟随(直接改 DOM,不走 re-render) */
  function moveEraserCursor(e: React.PointerEvent) {
    const el = eraserCursorRef.current
    if (!el) return
    if (tool !== 'eraser' || !canEdit) {
      el.style.display = 'none'
      return
    }
    const rect = canvasRef.current!.getBoundingClientRect()
    el.style.display = 'block'
    el.style.left = `${e.clientX - rect.left}px`
    el.style.top = `${e.clientY - rect.top}px`
  }

  function pushUndo() {
    undoStack.current.push(page.items)
    if (undoStack.current.length > 40) undoStack.current.shift()
    redoStack.current = []
  }

  function undo() {
    const prev = undoStack.current.pop()
    if (prev) {
      redoStack.current.push(page.items)
      onReplaceItems(prev)
    }
  }

  function redo() {
    const next = redoStack.current.pop()
    if (next) {
      undoStack.current.push(page.items)
      onReplaceItems(next)
    }
  }

  async function onFile(file: File | undefined, asBg: boolean) {
    if (!file || !canEdit) return
    try {
      const res = await processSkinImage(file)
      if (asBg) {
        pushUndo()
        onSetBg(res.dataUrl)
      } else {
        pushUndo()
        // 插入到当前视野中央,大小=半屏宽,按图片比例
        const ratio = res.height / Math.max(1, res.width)
        const w = 0.5
        const x = pan.x + (1 - w) / 2
        const y = pan.y + Math.max(0.03, (1 - w * ratio) / 2)
        onAddItems([{ id: uid('bi'), type: 'image', pts: [x, y, x + w, y + w * ratio], color: '#000', width: 0, src: res.dataUrl, by: 'me', at: Date.now() }])
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '图片处理失败')
    } finally {
      if (imgInput.current) imgInput.current.value = ''
      if (bgInput.current) bgInput.current.value = ''
    }
  }

  function clearPage() {
    if (!canEdit) return
    pushUndo()
    onReplaceItems([])
    setSelectedId(null)
  }

  /** 全屏讲课模式(希沃式:只留画布与工具栏) */
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await wrapRef.current?.parentElement?.requestFullscreen()
      }
    } catch {
      // 部分浏览器(如 iOS Safari)不支持元素全屏,忽略
    }
  }

  const cursorClass = panning ? ' grabbing' : tool === 'hand' ? ' hand' : ''

  return (
    <div className="wb">
      <div className="wb-toolbar" role="toolbar" aria-label="白板工具">
        {TOOL_META.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn btn-icon${tool === t.key ? ' on' : ''}`}
            title={t.label}
            aria-label={t.label}
            aria-pressed={tool === t.key}
            disabled={t.key !== 'hand' && !canEdit}
            onClick={() => setTool(t.key)}
          >
            {t.icon}
          </button>
        ))}
        <span className="wb-sep" />
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`wb-color${color === c ? ' on' : ''}`}
            style={{ background: c }}
            title={`颜色 ${c}`}
            aria-label={`选择颜色 ${c}`}
            aria-pressed={color === c}
            disabled={!canEdit}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="wb-sep" />
        <label className="wb-lw" title="笔迹粗细">
          粗细
          <input type="range" min={2} max={8} value={lineW} onChange={(e) => setLineW(Number(e.target.value))} disabled={!canEdit} aria-label="笔迹粗细" />
        </label>
        <span className="wb-sep" />
        <button type="button" className="btn btn-icon" title="撤销" aria-label="撤销" disabled={!canEdit || undoStack.current.length === 0} onClick={undo}>
          <Icon name="undo" size={15} />
        </button>
        <button type="button" className="btn btn-icon" title="恢复" aria-label="恢复" disabled={!canEdit || redoStack.current.length === 0} onClick={redo}>
          <Icon name="redo" size={15} />
        </button>
        <button type="button" className="btn btn-icon" title="清空本页" aria-label="清空本页" disabled={!canEdit} onClick={clearPage}>
          <Icon name="trash" size={15} />
        </button>
        {selectedId && canEdit && (
          <button
            type="button"
            className="btn btn-icon"
            title="删除选中元素"
            aria-label="删除选中元素"
            onClick={() => {
              pushUndo()
              onReplaceItems(page.items.filter((i) => i.id !== selectedId))
              setSelectedId(null)
            }}
          >
            <Icon name="close" size={15} />
          </button>
        )}
        <span className="wb-sep" />
        <button
          type="button"
          className="btn btn-icon"
          title="回到起点"
          aria-label="回到起点"
          onClick={() => setPan({ x: 0, y: 0 })}
        >
          <Icon name="target" size={15} />
        </button>
        <span className="wb-grid-pick" role="group" aria-label="页面底纹">
          {([
            { key: undefined, label: '白底' },
            { key: 'grid' as const, label: '方格' },
            { key: 'lines' as const, label: '横线' },
          ]).map((g) => (
            <button
              key={g.label}
              type="button"
              className={`chip chip-${(page.grid ?? undefined) === g.key ? 'blue' : 'gray'}`}
              disabled={!canEdit}
              onClick={() => onSetGrid?.(g.key)}
              aria-pressed={(page.grid ?? undefined) === g.key}
            >
              {g.label}
            </button>
          ))}
        </span>
        <span className="wb-sep" />
        <button type="button" className="btn btn-icon" title={fullscreen ? '退出全屏讲课' : '全屏讲课'} aria-label={fullscreen ? '退出全屏讲课' : '全屏讲课'} onClick={() => void toggleFullscreen()}>
          <Icon name="eye" size={15} />
        </button>
        <span className="wb-sep" />
        <button type="button" className="btn btn-sm" disabled={!canEdit} onClick={() => imgInput.current?.click()}>
          <Icon name="image" size={14} /> 插入题目图片
        </button>
        <button type="button" className="btn btn-sm" disabled={!canEdit} onClick={() => bgInput.current?.click()}>
          <Icon name="upload" size={14} /> 设为本页底图
        </button>
        <input ref={imgInput} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => void onFile(e.target.files?.[0], false)} />
        <input ref={bgInput} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => void onFile(e.target.files?.[0], true)} />
      </div>

      <div className={`wb-canvas-wrap${cursorClass}`} ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`wb-canvas${canEdit ? '' : ' readonly'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => onPointerUp()}
          onPointerLeave={() => onPointerUp()}
          onDoubleClick={onDoubleClickText}
          aria-label="白板画布(无限画布:滚轮或手型工具平移)"
        />
        <div ref={eraserCursorRef} className="wb-eraser-cursor" aria-hidden style={{ display: 'none' }} />
        {textInput && (
          <div className="wb-text-input" style={{ left: `${(textInput.x - pan.x) * 100}%`, top: `${(textInput.y - pan.y) * 100}%` }}>
            <textarea
              autoFocus
              value={textInput.value}
              placeholder="输入内容,Enter 确认"
              rows={2}
              onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitText()
                }
                if (e.key === 'Escape') setTextInput(null)
              }}
            />
            <button className="btn btn-xs btn-primary" onClick={commitText}>
              确定
            </button>
          </div>
        )}
        {!canEdit && <div className="wb-lock">{lockNote ?? '只读模式:主讲人未开放编辑'}</div>}
      </div>
      <p className="muted wb-hint">无限画布:滚轮上下移、Shift+滚轮左右移;或选手型工具按住拖到任意方向;「回到起点」跳回 (0,0)。</p>
    </div>
  )
}

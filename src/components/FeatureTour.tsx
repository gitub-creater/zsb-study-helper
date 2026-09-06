// 新手引导蒙层:高亮目标元素 + 箭头提示卡,逐步指导;每次进入页面都会出现,
// 用户可「跟随教程」走完,也可点「跳过教程(已学会)」直接关闭。
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'

export interface TourStep {
  /** 目标元素选择器(data-tour="xxx" → '[data-tour="xxx"]') */
  sel: string
  title: string
  text: string
  /** 提示卡优先停靠方位;空间不足自动换边 */
  prefer?: 'bottom' | 'top' | 'left' | 'right'
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const CARD_W = 300
const GAP = 14

export function FeatureTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const step = steps[idx]

  const measure = useCallback(() => {
    if (!step) return
    const el = document.querySelector(step.sel)
    if (!el) {
      setRect(null)
      return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }, 220)
  }, [step])

  useEffect(() => {
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [measure])

  // 目标不存在时自动跳到下一个存在的步骤
  useEffect(() => {
    if (rect) return
    const timer = window.setTimeout(() => {
      setIdx((i) => (i + 1 < steps.length ? i + 1 : i))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [rect, steps.length])

  const cardPos = useMemo(() => {
    if (!rect || !step) return { top: 120, left: 80, arrow: step?.prefer ?? 'bottom' }
    const prefer = step.prefer ?? 'bottom'
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let top = rect.top + rect.height + GAP
    let left = Math.min(Math.max(12, cx - CARD_W / 2), vw - CARD_W - 12)
    let arrow: TourStep['prefer'] = 'top'
    if (prefer === 'bottom' && top + 170 < vh) return { top, left, arrow: 'top' }
    if (prefer === 'top' || (top + 170 >= vh && rect.top - 170 > 8)) {
      top = Math.max(12, rect.top - 170 - GAP)
      arrow = 'bottom'
      return { top, left, arrow }
    }
    if (prefer === 'left' || rect.left > vw / 2) {
      left = Math.max(12, rect.left - CARD_W - GAP)
      top = Math.max(12, Math.min(cy - 70, vh - 190))
      arrow = 'right'
      return { top, left, arrow }
    }
    left = Math.min(vw - CARD_W - 12, rect.left + rect.width + GAP)
    top = Math.max(12, Math.min(cy - 70, vh - 190))
    arrow = 'left'
    return { top, left, arrow }
  }, [rect, step])

  if (!step) return null
  const last = idx === steps.length - 1

  return (
    <div className="tour-root" role="dialog" aria-label="新手引导" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {/* 四块遮罩围出高亮洞 */}
      {rect ? (
        <>
          <div className="tour-mask" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top - 6) }} />
          <div className="tour-mask" style={{ top: rect.top + rect.height + 6, left: 0, right: 0, bottom: 0 }} />
          <div className="tour-mask" style={{ top: rect.top - 6, left: 0, width: Math.max(0, rect.left - 6), height: rect.height + 12 }} />
          <div className="tour-mask" style={{ top: rect.top - 6, left: rect.left + rect.width + 6, right: 0, height: rect.height + 12 }} />
          <div className="tour-hole" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
        </>
      ) : (
        <div className="tour-mask" style={{ inset: 0 }} />
      )}

      {/* 提示卡(带指向箭头) */}
      <div className={`tour-card arrow-${cardPos.arrow}`} style={{ top: cardPos.top, left: cardPos.left, width: CARD_W }}>
        <div className="tour-card-h">
          <span className="tour-badge num">{idx + 1}/{steps.length}</span>
          <b>{step.title}</b>
          <button className="btn btn-xs tour-skip" onClick={onClose} title="关闭引导">
            跳过教程(已学会) <Icon name="close" size={12} />
          </button>
        </div>
        <p className="tour-text">{step.text}</p>
        <div className="tour-ops">
          {idx > 0 && (
            <button className="btn btn-sm" onClick={() => setIdx((i) => Math.max(0, i - 1))}>
              <Icon name="left" size={13} /> 上一步
            </button>
          )}
          <span className="grow" />
          {last ? (
            <button className="btn btn-sm btn-primary" onClick={onClose}>
              <Icon name="check" size={13} /> 完成
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}>
              下一步 <Icon name="right" size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 把步骤里不存在的目标过滤掉(页面元素可能因状态未出现) */
export function filterExistingSteps(steps: TourStep[]): TourStep[] {
  return steps.filter((s) => {
    try {
      return !!document.querySelector(s.sel)
    } catch {
      return false
    }
  })
}

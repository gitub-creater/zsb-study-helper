// 通用 UI 组件:Modal / Toast / 确认框 / 分段控件 / 步进器 / 进度条 / 空状态
import React, { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Mascot } from './Mascot'
import type { MascotMood } from './Mascot'
import { clamp } from '../lib/misc'

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width,
}: {
  open: boolean
  title: string
  onClose?: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="modal" style={width ? { maxWidth: width } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <b>{title}</b>
          {onClose && (
            <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="关闭">
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-l">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  small,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  small?: boolean
}) {
  return (
    <div className={small ? 'seg seg-sm' : 'seg'} role="tablist">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label="减少" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="num">{value}</span>
      <button type="button" aria-label="增加" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  )
}

export function Bar({
  value,
  tone = 'blue',
}: {
  value: number | null
  tone?: 'blue' | 'green' | 'yellow' | 'red' | 'gray'
}) {
  if (value == null) {
    return (
      <div className="bar-empty">
        <Icon name="eye" size={13} /> 数据不足,多练几题再看
      </div>
    )
  }
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i className={`tone-${tone}`} style={{ width: `${clamp(value, 0, 100)}%` }} />
    </div>
  )
}

export function Chip({ tone = 'gray', children }: { tone?: 'gray' | 'blue' | 'green' | 'red' | 'yellow'; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

export function EmptyState({
  mood = 'think',
  title,
  desc,
  action,
}: {
  mood?: MascotMood
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <Mascot mood={mood} size={76} />
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action}
    </div>
  )
}

/** 删除等危险操作的确认框 */
export function useConfirm(): [
  ReactNode,
  (opts: { title: string; desc?: string; danger?: boolean; confirmText?: string }) => Promise<boolean>,
] {
  const [req, setReq] = useState<{
    title: string
    desc?: string
    danger?: boolean
    confirmText?: string
    resolve: (v: boolean) => void
  } | null>(null)
  const confirm = useCallback(
    (opts: { title: string; desc?: string; danger?: boolean; confirmText?: string }) =>
      new Promise<boolean>((resolve) => setReq({ ...opts, resolve })),
    []
  )
  const close = (v: boolean) => {
    req?.resolve(v)
    setReq(null)
  }
  const node = (
    <Modal
      open={!!req}
      title={req?.title ?? ''}
      onClose={() => close(false)}
      width={400}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            取消
          </button>
          <button className={req?.danger ? 'btn btn-danger-solid' : 'btn btn-primary'} onClick={() => close(true)}>
            {req?.confirmText ?? '确定'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {req?.desc}
      </p>
    </Modal>
  )
  return [node, confirm]
}

type ToastItem = {
  id: number
  msg: string
  kind: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
}

type ToastFn = (msg: string, opts?: { kind?: ToastItem['kind']; action?: ToastItem['action']; duration?: number }) => void

const ToastCtx = createContext<ToastFn>(() => {})

export function useToast(): ToastFn {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback<ToastFn>((msg, opts = {}) => {
    const id = Date.now() + Math.random()
    const duration = opts.duration ?? (opts.action ? 6000 : 2600)
    setItems((list) => [...list.slice(-3), { id, msg, kind: opts.kind ?? 'info', action: opts.action }])
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), duration)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.kind === 'success' && <Icon name="check" size={15} />}
            {t.kind === 'error' && <Icon name="close" size={15} />}
            <span>{t.msg}</span>
            {t.action && (
              <span
                className="act"
                role="button"
                tabIndex={0}
                onClick={() => {
                  t.action!.onClick()
                  setItems((l) => l.filter((x) => x.id !== t.id))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    t.action!.onClick()
                    setItems((l) => l.filter((x) => x.id !== t.id))
                  }
                }}
              >
                {t.action.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

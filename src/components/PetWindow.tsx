// 桌面宠物「芽芽」:单实例静音悬浮窗。可拖动、两档缩放、最小化与关闭;
// 通过窗口事件接收任务提醒与讲题进度,只用动画与文字气泡,不播放任何声音。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Mascot, type MascotMood } from './Mascot'
import { Icon } from './Icon'
import { SNOOZE_MINUTES } from '../lib/schedule'
import {
  clampPetPosition,
  enqueuePetMessage,
  onPetEvent,
  petIdleEncouragement,
  petMessageDuration,
  petStudyDoneReply,
  petStudyStartReply,
  petTaskDismissReply,
  petTaskDoneReply,
  petTaskGreeting,
  petTaskSnoozeReply,
  shouldPromptIdle,
} from '../lib/pet'
import type { PetActionId, PetMessage, PetMood } from '../lib/pet'
import type { PetSettings } from '../types'

/** 浮窗标准档尺寸(px);放大档按 1.25 倍计算。 */
const PET_WIDTH = 168
const PET_HEIGHT = 216
const SCALE_1: PetSettings['scale'] = 1

function petSize(scale: PetSettings['scale'] | undefined) {
  const factor = scale === 1.25 ? 1.25 : 1
  return { width: Math.round(PET_WIDTH * factor), height: Math.round(PET_HEIGHT * factor) }
}

export function PetWindow() {
  const { state, dispatch } = useStore()
  const pet: PetSettings = state.settings.pet ?? { enabled: true }
  const [queue, setQueue] = useState<PetMessage[]>([])
  const [mood, setMood] = useState<PetMood>('idle')
  const [pos, setPos] = useState<{ x: number; y: number }>(() =>
    clampPetPosition(pet.x ?? 24, pet.y ?? 120, petSize(pet.scale).width, petSize(pet.scale).height, window.innerWidth, window.innerHeight),
  )
  const [dragging, setDragging] = useState(false)
  const studyActiveRef = useRef(false)
  const lastActiveRef = useRef(Date.now())
  const lastIdlePromptRef = useRef(0)
  const dragRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null)
  const moodRef = useRef<PetMood>('idle')
  moodRef.current = mood
  const queueRef = useRef<PetMessage[]>([])
  queueRef.current = queue

  const persist = useCallback(
    (patch: Partial<PetSettings>) => {
      dispatch({ type: 'SET_SETTINGS', patch: { pet: { ...pet, ...patch } } })
    },
    [dispatch, pet],
  )

  const current = queue[0]

  // 当前气泡到时自动消失;队列里的下一条自动接上。
  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(() => {
      setQueue((prev) => prev.slice(1))
    }, petMessageDuration(current.text))
    return () => window.clearTimeout(timer)
  }, [current])

  // 队列放空后,讲题期间保持思考状态,其余场景回到待机。
  useEffect(() => {
    if (queue.length > 0) return
    const timer = window.setTimeout(() => {
      setMood(studyActiveRef.current ? 'think' : 'idle')
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [queue.length])

  // 接收任务提醒与讲题进度事件。
  useEffect(() => {
    return onPetEvent((detail) => {
      if (detail.type === 'task') {
        const { task } = detail
        studyActiveRef.current = false
        setMood('remind')
        setQueue((prev) =>
          enqueuePetMessage(prev, {
            text: petTaskGreeting(task.name, task.lateMinutes),
            mood: 'remind',
            taskId: task.taskId,
            taskKey: task.taskKey,
            name: task.name,
            test: task.test,
            actions: task.test ? [{ id: 'dismiss', label: '知道啦' }] : [
              { id: 'done', label: '完成' },
              { id: 'snooze', label: '稍后' },
              { id: 'dismiss', label: '忽略' },
            ],
          }),
        )
        return
      }
      if (detail.phase === 'start') {
        studyActiveRef.current = true
        setMood('think')
        setQueue((prev) => enqueuePetMessage(prev, { text: petStudyStartReply(), mood: 'think' }))
      } else {
        studyActiveRef.current = false
        setMood('happy')
        setQueue((prev) => enqueuePetMessage(prev, { text: petStudyDoneReply(), mood: 'happy' }))
      }
    })
  }, [])

  // 闲置检测:长时间没有输入且页面可见时说一句鼓励的话,间隔内不重复。
  useEffect(() => {
    const markActive = () => {
      lastActiveRef.current = Date.now()
    }
    window.addEventListener('pointerdown', markActive, { passive: true })
    window.addEventListener('pointermove', markActive, { passive: true })
    window.addEventListener('keydown', markActive)
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (queueRef.current.length > 0) return
      const now = Date.now()
      if (!shouldPromptIdle(lastActiveRef.current, lastIdlePromptRef.current, now)) return
      lastIdlePromptRef.current = now
      setMood('idle')
      setQueue((prev) => enqueuePetMessage(prev, { text: petIdleEncouragement(), mood: 'idle' }))
    }, 30_000)
    return () => {
      window.removeEventListener('pointerdown', markActive)
      window.removeEventListener('pointermove', markActive)
      window.removeEventListener('keydown', markActive)
      window.clearInterval(timer)
    }
  }, [])

  // 视口尺寸变化时把浮窗收敛回可视范围。
  useEffect(() => {
    const onResize = () => {
      const { width, height } = petSize(pet.scale)
      setPos((prev) => clampPetPosition(prev.x, prev.y, width, height, window.innerWidth, window.innerHeight))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pet.scale])

  const onDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: pos.x, originY: pos.y }
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [pos.x, pos.y],
  )

  const onDragMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const { width, height } = petSize(pet.scale)
      setPos(
        clampPetPosition(
          drag.originX + (event.clientX - drag.pointerX),
          drag.originY + (event.clientY - drag.pointerY),
          width,
          height,
          window.innerWidth,
          window.innerHeight,
        ),
      )
    },
    [pet.scale],
  )

  const onDragEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      dragRef.current = null
      setDragging(false)
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* 指针已释放时忽略 */
      }
      setPos((final) => {
        persist({ x: final.x, y: final.y })
        return final
      })
    },
    [persist],
  )

  const dismissCurrent = useCallback(() => {
    setQueue((prev) => prev.slice(1))
  }, [])

  const onAction = useCallback(
    (message: PetMessage, action: PetActionId) => {
      if (message.taskId && message.taskKey) {
        const { taskId, taskKey } = message
        if (action === 'done') dispatch({ type: 'SCHEDULE_DONE', id: taskId, key: taskKey })
        if (action === 'snooze') {
          dispatch({
            type: 'SCHEDULE_SNOOZE',
            id: taskId,
            key: taskKey,
            until: new Date(Date.now() + SNOOZE_MINUTES * 60000).toISOString(),
          })
        }
        if (action === 'dismiss') dispatch({ type: 'SCHEDULE_NOTIFIED', id: taskId, key: taskKey })
        const reply = action === 'done'
          ? petTaskDoneReply(message.name ?? '任务')
          : action === 'snooze'
            ? petTaskSnoozeReply(message.name ?? '任务')
            : petTaskDismissReply(message.name ?? '任务')
        const replyMood: PetMood = action === 'done' ? 'happy' : 'idle'
        setMood(replyMood)
        setQueue([{ id: `petmsg-reply-${Date.now().toString(36)}`, text: reply, mood: replyMood }])
        return
      }
      dismissCurrent()
    },
    [dispatch, dismissCurrent],
  )

  if (!pet.enabled) return null

  if (pet.minimized) {
    return (
      <button
        type="button"
        className="pet-ball"
        style={{ left: pos.x, top: pos.y }}
        aria-label="打开学习宠物芽芽"
        title="打开芽芽"
        onClick={() => persist({ minimized: false })}
      >
        <Mascot mood="idle" size={40} />
        {queue.length > 0 && <i className="pet-ball-dot" aria-hidden />}
      </button>
    )
  }

  const { width, height } = petSize(pet.scale)

  return (
    <section
      className={`pet-float is-${mood}${dragging ? ' is-dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, width, minHeight: height }}
      aria-label="学习宠物芽芽"
    >
      <div
        className="pet-head"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className="pet-head-title">
          <Icon name="sparkle" size={12} /> 芽芽陪学
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="pet-btn"
          aria-label={pet.scale === 1.25 ? '恢复标准大小' : '放大宠物窗口'}
          title={pet.scale === 1.25 ? '恢复标准大小' : '放大'}
          onClick={() => persist({ scale: pet.scale === 1.25 ? SCALE_1 : 1.25 })}
        >
          {pet.scale === 1.25 ? '−' : '+'}
        </button>
        <button
          type="button"
          className="pet-btn"
          aria-label="最小化宠物"
          title="最小化"
          onClick={() => persist({ minimized: true })}
        >
          <Icon name="up" size={12} />
        </button>
        <button
          type="button"
          className="pet-btn"
          aria-label="关闭宠物(可在设置中重新开启)"
          title="关闭"
          onClick={() => persist({ enabled: false })}
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      {current ? (
        <div className="pet-bubble" role="status" onClick={dismissCurrent} title="点击看下一条">
          <p>{current.text}</p>
          {current.actions && current.actions.length > 0 && (
            <div className="pet-bubble-actions" onClick={(event) => event.stopPropagation()}>
              {current.actions.map((action) => (
                <button
                  key={action.id + action.label}
                  type="button"
                  className={`btn btn-xs${action.id === 'done' ? ' btn-primary' : ''}`}
                  disabled={current.test && action.id !== 'dismiss'}
                  onClick={() => onAction(current, action.id)}
                >
                  {action.id === 'done' && <Icon name="check" size={11} />}
                  {action.label}
                </button>
              ))}
            </div>
          )}
          {queue.length > 1 && <span className="pet-bubble-more">还有 {queue.length - 1} 条</span>}
        </div>
      ) : (
        <div className="pet-hint" aria-hidden>
          {mood === 'think' ? '认真讲题中…' : '芽芽在你身边'}
        </div>
      )}

      <div className="pet-stage">
        <Mascot mood={mood} size={Math.round((pet.scale === 1.25 ? 96 : 78))} />
      </div>
    </section>
  )
}

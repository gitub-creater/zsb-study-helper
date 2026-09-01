// 桌面宠物:一只"活"的小生物,直接站在页面上(没有卡片外壳)。
// 它会在屏幕底部踱步、张望、坐下、打盹;任务到点跑到屏幕中间举旗提醒;
// 讲题时坐下来陪伴;点击它会兴奋跳起来。全程静音,只用动画与文字气泡。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Icon } from './Icon'
import { PetCreature } from './PetCreature'
import { SNOOZE_MINUTES } from '../lib/schedule'
import {
  CREATURES,
  advanceCreature,
  creatureStateDuration,
  enqueuePetMessage,
  nextCreatureState,
  nextWalkTarget,
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
import type { CreatureProfile, CreatureState } from '../lib/pet'
import type { PetActionId, PetMessage } from '../lib/pet'
import type { AvatarKind, PetSettings } from '../types'

/** 宠物脚底离视口底部的活动带高度:在这条带子里活动,像在桌面前踱步。 */
const FLOOR_BAND = 26
/** 生物渲染尺寸:标准/放大两档。 */
function creatureSize(scale: PetSettings['scale'] | undefined) {
  return scale === 1.25 ? 120 : 96
}

interface BrainState {
  creature: CreatureState
  x: number
  target: number
  facing: 1 | -1
  stateUntil: number
  /** 被任务/讲题事件接管,期间不跑自由行为。 */
  lockedUntil: number
}

export function PetWindow() {
  const { state, dispatch } = useStore()
  const pet: PetSettings = state.settings.pet ?? { enabled: true }
  const species: CreatureProfile = CREATURES[(pet.avatar ?? 'sprout') as AvatarKind] ?? CREATURES.sprout
  const size = creatureSize(pet.scale)
  const [brain, setBrain] = useState<BrainState>(() => ({
    creature: 'walk',
    x: 40,
    target: 320,
    facing: 1,
    stateUntil: 0,
    lockedUntil: 0,
  }))
  const [queue, setQueue] = useState<PetMessage[]>([])
  const [toolsOpen, setToolsOpen] = useState(false)
  const brainRef = useRef(brain)
  brainRef.current = brain
  const queueRef = useRef<PetMessage[]>([])
  queueRef.current = queue
  const studyActiveRef = useRef(false)
  const lastActiveRef = useRef(Date.now())
  const lastIdlePromptRef = useRef(0)
  const lastPetClickRef = useRef(0)
  const viewportRef = useRef({ w: window.innerWidth, h: window.innerHeight })

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

  // 行为心跳:走路推进位置,其他状态到点切换,像一只自己拿主意的小生物。
  useEffect(() => {
    if (!pet.enabled || pet.minimized) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setBrain((prev) => {
        // 被提醒/讲题接管期间:位置照常逼近目标点,行为不自由切换。
        if (now < prev.lockedUntil) {
          if (prev.creature === 'walk') {
            const moved = advanceCreature(prev.x, prev.target, species.speed * 1.6, 120)
            return { ...prev, x: moved.x, facing: moved.x < prev.target ? -1 : 1 }
          }
          return prev
        }
        if (prev.creature === 'walk') {
          const moved = advanceCreature(prev.x, prev.target, species.speed, 120)
          if (!moved.arrived) {
            return { ...prev, x: moved.x, facing: moved.x < prev.target ? -1 : 1 }
          }
          const next = nextCreatureState('walk', Math.random())
          return {
            ...prev,
            x: moved.x,
            creature: next,
            stateUntil: now + creatureStateDuration(next, Math.random()),
          }
        }
        if (now < prev.stateUntil) return prev
        const next = nextCreatureState(prev.creature, Math.random())
        const duration = creatureStateDuration(next, Math.random())
        if (next === 'walk') {
          const target = nextWalkTarget(prev.x, viewportRef.current.w)
          return { ...prev, creature: 'walk', target, stateUntil: now + duration }
        }
        return { ...prev, creature: next, stateUntil: now + duration }
      })
    }, 120)
    return () => window.clearInterval(timer)
  }, [pet.enabled, pet.minimized, species.speed])

  // 接收任务提醒与讲题进度事件:跑到屏幕中央举旗/坐下陪伴。
  useEffect(() => {
    return onPetEvent((detail) => {
      if (detail.type === 'task') {
        const { task } = detail
        studyActiveRef.current = false
        const midX = Math.max(90, viewportRef.current.w / 2 - size / 2)
        setBrain((prev) => ({
          ...prev,
          creature: 'remind',
          target: midX,
          lockedUntil: Date.now() + 5200,
          stateUntil: Date.now() + 5200,
        }))
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
        const midX = Math.max(90, viewportRef.current.w / 2 - size / 2)
        setBrain((prev) => ({ ...prev, creature: 'sit', target: midX, lockedUntil: Date.now() + 4000, stateUntil: Date.now() + 4000 }))
        setQueue((prev) => enqueuePetMessage(prev, { text: petStudyStartReply(), mood: 'think' }))
      } else {
        studyActiveRef.current = false
        setBrain((prev) => ({ ...prev, creature: 'excited', lockedUntil: Date.now() + 1500, stateUntil: Date.now() + 1500 }))
        setQueue((prev) => enqueuePetMessage(prev, { text: petStudyDoneReply(), mood: 'happy' }))
      }
    })
  }, [size])

  // 闲置检测:长时间没有输入时说一句鼓励的话,间隔内不重复。
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
      setQueue((prev) => enqueuePetMessage(prev, { text: petIdleEncouragement(), mood: 'idle' }))
    }, 30_000)
    return () => {
      window.removeEventListener('pointerdown', markActive)
      window.removeEventListener('pointermove', markActive)
      window.removeEventListener('keydown', markActive)
      window.clearInterval(timer)
    }
  }, [])

  // 视口变化时把宠物收敛回画面内。
  useEffect(() => {
    const onResize = () => {
      viewportRef.current = { w: window.innerWidth, h: window.innerHeight }
      setBrain((prev) => ({ ...prev, x: Math.min(Math.max(20, prev.x), Math.max(20, viewportRef.current.w - size - 10)) }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [size])

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
        const replyMood = action === 'done' ? 'happy' : 'idle'
        const reply = action === 'done'
          ? petTaskDoneReply(message.name ?? '任务')
          : action === 'snooze'
            ? petTaskSnoozeReply(message.name ?? '任务')
            : petTaskDismissReply(message.name ?? '任务')
        setQueue([{ id: `petmsg-reply-${Date.now().toString(36)}`, text: reply, mood: replyMood }])
        setBrain((prev) => ({ ...prev, creature: action === 'done' ? 'excited' : 'look', lockedUntil: Date.now() + 1500, stateUntil: Date.now() + 1500 }))
        return
      }
      dismissCurrent()
    },
    [dispatch, dismissCurrent],
  )

  // 点一下宠物:蹦跳撒星星,偶尔说句话。
  const onCreatureClick = useCallback(() => {
    const now = Date.now()
    if (now - lastPetClickRef.current < 2600) return
    lastPetClickRef.current = now
    setBrain((prev) => ({ ...prev, creature: 'excited', lockedUntil: now + 1500, stateUntil: now + 1500 }))
    if (queueRef.current.length === 0) {
      setQueue((prev) => enqueuePetMessage(prev, { text: `${species.name}跳起来啦!继续加油哦~`, mood: 'happy' }))
    }
  }, [species.name])

  if (!pet.enabled) return null

  // 最小化:宠物趴在右下角打盹,点它醒来。
  if (pet.minimized) {
    return (
      <div className="pet-live is-min" style={{ left: window.innerWidth - size - 18 }}>
        <button type="button" className="pet-creature-btn" aria-label="唤醒宠物" title="唤醒" onClick={() => persist({ minimized: false })}>
          <PetCreature species={species} state="sleep" size={64} />
        </button>
      </div>
    )
  }

  const bottom = 14 + ((species.speed * 7) % FLOOR_BAND)
  const showBubble = !!current

  return (
    <div
      className={`pet-live${showBubble ? ' has-bubble' : ''}`}
      style={{ left: brain.x, bottom }}
      aria-label={`桌面宠物${species.name}`}
    >
      {showBubble && (
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
      )}

      <div className="pet-creature-wrap" onMouseEnter={() => setToolsOpen(true)} onMouseLeave={() => setToolsOpen(false)}>
        <div className="pet-tools" data-open={toolsOpen}>
          <button type="button" className="pet-btn" aria-label="放大或还原宠物" title="大小" onClick={() => persist({ scale: pet.scale === 1.25 ? 1 : 1.25 })}>
            {pet.scale === 1.25 ? '−' : '+'}
          </button>
          <button type="button" className="pet-btn" aria-label="让宠物打盹(最小化)" title="打盹" onClick={() => persist({ minimized: true })}>
            <Icon name="up" size={11} />
          </button>
          <button type="button" className="pet-btn" aria-label="送走宠物(可在设置页找回)" title="送走" onClick={() => persist({ enabled: false })}>
            <Icon name="close" size={11} />
          </button>
        </div>
        <button type="button" className="pet-creature-btn" aria-label={`和${species.name}互动`} onClick={onCreatureClick}>
          <PetCreature
            species={species}
            state={brain.creature === 'walk' ? 'walk' : brain.creature}
            size={size}
            facing={brain.facing}
          />
        </button>
      </div>
    </div>
  )
}

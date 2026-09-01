import { describe, expect, it, vi } from 'vitest'
import {
  CREATURES,
  CREATURE_ORDER,
  PET_QUEUE_LIMIT,
  advanceCreature,
  clampPetPosition,
  creatureStateDuration,
  enqueuePetMessage,
  emitPetEvent,
  nextCreatureState,
  nextPetMessageId,
  nextWalkTarget,
  onPetEvent,
  petMessageDuration,
  petTaskDoneReply,
  petTaskGreeting,
  petTaskSnoozeReply,
  shouldPromptIdle,
} from '../src/lib/pet'
import type { PetMessage, PetTaskDetail } from '../src/lib/pet'

function taskMessage(overrides: Partial<PetMessage> = {}): PetMessage {
  return {
    id: nextPetMessageId(),
    text: '该开始学习「背诵英语词汇」啦！',
    mood: 'remind',
    taskId: 'sch-1',
    taskKey: '2026-09-02T08:00',
    name: '背诵英语词汇',
    actions: [
      { id: 'done', label: '完成' },
      { id: 'snooze', label: '稍后' },
      { id: 'dismiss', label: '忽略' },
    ],
    ...overrides,
  }
}

describe('宠物生物行为', () => {
  it('四只角色齐全且速度性格各不相同', () => {
    expect(CREATURE_ORDER).toEqual(['sprout', 'cat', 'rabbit', 'bear'])
    const speeds = CREATURE_ORDER.map((id) => CREATURES[id].speed)
    expect(new Set(speeds).size).toBe(CREATURE_ORDER.length)
    for (const id of CREATURE_ORDER) {
      expect(CREATURES[id].name).toBeTruthy()
      expect(CREATURES[id].trait).toBeTruthy()
    }
  })

  it('行为链循环推进,不会卡死在单个状态', () => {
    let state = nextCreatureState('walk', 0.01)
    expect(['look', 'sit', 'sleep', 'walk']).toContain(state)
    // 任意随机数都能得到合法状态
    for (let roll = 0; roll <= 10; roll += 1) {
      const next = nextCreatureState('sleep', roll / 10)
      expect(['walk', 'sit', 'look', 'sleep', 'excited', 'remind', 'think']).toContain(next)
    }
  })

  it('走路按速度推进并在到达时停下', () => {
    const far = advanceCreature(0, 300, 60, 1000)
    expect(far).toEqual({ x: 60, arrived: false })
    const near = advanceCreature(290, 300, 60, 1000)
    expect(near).toEqual({ x: 300, arrived: true })
    const backward = advanceCreature(300, 100, 60, 1000)
    expect(backward.x).toBe(240)
  })

  it('踱步目标始终在视口内,且与当前位置保持距离', () => {
    for (let i = 0; i < 30; i += 1) {
      const target = nextWalkTarget(400, 900)
      expect(target).toBeGreaterThanOrEqual(70)
      expect(target).toBeLessThanOrEqual(830)
    }
  })

  it('各状态都有正的持续时间,打盹最久', () => {
    const walk = creatureStateDuration('walk', 0.5)
    const sleep = creatureStateDuration('sleep', 0.5)
    const look = creatureStateDuration('look', 0.5)
    expect(walk).toBeGreaterThan(0)
    expect(look).toBeGreaterThan(0)
    expect(sleep).toBeGreaterThan(walk)
  })
})

describe('宠物消息队列', () => {
  it('消息按顺序追加，超过上限时丢弃最旧的', () => {
    let queue: PetMessage[] = []
    for (let index = 0; index < PET_QUEUE_LIMIT + 2; index += 1) {
      queue = enqueuePetMessage(queue, { text: `消息 ${index}`, mood: 'idle' })
    }
    expect(queue).toHaveLength(PET_QUEUE_LIMIT)
    expect(queue[0].text).toBe('消息 2')
    expect(queue[queue.length - 1].text).toBe(`消息 ${PET_QUEUE_LIMIT + 1}`)
  })

  it('气泡停留时长随文字长度增加，且有上下限', () => {
    expect(petMessageDuration('短')).toBe(4500)
    expect(petMessageDuration('长'.repeat(200))).toBe(14000)
    expect(petMessageDuration('中等长度的提示语，大约二十个字。')).toBeGreaterThan(5000)
  })
})

describe('宠物文案', () => {
  it('任务提醒包含任务名，迟到时补充迟到说明', () => {
    expect(petTaskGreeting('背诵英语词汇')).toContain('背诵英语词汇')
    const late = petTaskGreeting('数学刷题', 12)
    expect(late).toContain('数学刷题')
    expect(late).toContain('12 分钟')
  })

  it('完成、延后的回复语义正确', () => {
    expect(petTaskDoneReply('背诵英语词汇')).toContain('背诵英语词汇')
    expect(petTaskSnoozeReply('背诵英语词汇')).toContain('5 分钟')
  })
})

describe('闲置鼓励节流', () => {
  it('未闲置不发、刚发过不发、闲置且间隔足够才发', () => {
    const now = 1_000_000
    // 刚活动过：不提醒
    expect(shouldPromptIdle(now - 10_000, 0, now)).toBe(false)
    // 闲置了，但 5 分钟内已经提醒过：不再提醒
    expect(shouldPromptIdle(now - 120_000, now - 60_000, now)).toBe(false)
    // 闲置且距上次提醒超过间隔：提醒
    expect(shouldPromptIdle(now - 120_000, now - 400_000, now)).toBe(true)
  })
})

describe('浮窗位置收敛', () => {
  it('拖出视口时收敛到边缘，视口内保持原位', () => {
    expect(clampPetPosition(-50, -20, 168, 216, 800, 600)).toEqual({ x: 0, y: 0 })
    expect(clampPetPosition(1200, 900, 168, 216, 800, 600)).toEqual({ x: 632, y: 384 })
    expect(clampPetPosition(100, 80, 168, 216, 800, 600)).toEqual({ x: 100, y: 80 })
  })
})

describe('宠物事件总线', () => {
  it('任务与讲题事件按序送达，取消订阅后不再接收', () => {
    vi.stubGlobal('window', new EventTarget())
    const received: Array<{ type: string; phase?: string; name?: string }> = []
    const stop = onPetEvent((detail) => {
      if (detail.type === 'task') received.push({ type: 'task', name: detail.task.name })
      else received.push({ type: 'study', phase: detail.phase })
    })

    const task: PetTaskDetail = {
      taskId: 'sch-9',
      taskKey: '2026-09-02T09:30',
      name: '数学真题卷',
    }
    emitPetEvent({ type: 'task', task })
    emitPetEvent({ type: 'study', phase: 'start' })
    stop()
    emitPetEvent({ type: 'study', phase: 'done' })

    expect(received).toEqual([
      { type: 'task', name: '数学真题卷' },
      { type: 'study', phase: 'start' },
    ])
    vi.unstubAllGlobals()
  })

  it('宠物关闭时事件不会抛错（无监听者）', () => {
    vi.stubGlobal('window', new EventTarget())
    expect(() => emitPetEvent({ type: 'study', phase: 'done' })).not.toThrow()
    vi.unstubAllGlobals()
  })
})

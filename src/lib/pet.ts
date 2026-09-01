// 桌面宠物「芽芽」的纯逻辑层：事件总线、消息队列、动作文案与闲置检测。
// 组件层（PetWindow）只负责渲染与交互，所有可测逻辑集中在这里。

export const PET_EVENT = 'zsb-pet-event'

export type PetMood = 'idle' | 'think' | 'happy' | 'remind'

export interface PetTaskDetail {
  taskId: string
  /** 发生时刻 key（与 SCHEDULE_NOTIFIED 等动作的 key 一致）。 */
  taskKey: string
  name: string
  content?: string
  lateMinutes?: number
  test?: boolean
}

export type PetEventDetail =
  | { type: 'task'; task: PetTaskDetail }
  | { type: 'study'; phase: 'start' | 'done' }

export type PetActionId = 'done' | 'snooze' | 'dismiss'

export interface PetAction {
  id: PetActionId
  label: string
}

export interface PetMessage {
  id: string
  text: string
  mood: PetMood
  /** 任务类消息携带，供「完成/稍后/忽略」操作回写任务计划。 */
  taskId?: string
  taskKey?: string
  /** 任务名称，用于操作后的回复文案。 */
  name?: string
  test?: boolean
  actions?: PetAction[]
}

// ---- 事件总线 ----

/** 浏览器用 window；测试环境可能只有裸 EventTarget，做能力检测后回退。 */
function petEventTarget(): EventTarget | null {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') return window
  const target = globalThis as unknown as { addEventListener?: unknown }
  if (typeof target.addEventListener === 'function') return globalThis as unknown as EventTarget
  return null
}

/** 任务提醒、讲题进度通过这个窗口事件喂给宠物；宠物未开启时事件无人消费，无副作用。 */
export function emitPetEvent(detail: PetEventDetail): void {
  const target = petEventTarget()
  if (!target || typeof CustomEvent === 'undefined') return
  target.dispatchEvent(new CustomEvent(PET_EVENT, { detail }))
}

export function onPetEvent(handler: (detail: PetEventDetail) => void): () => void {
  const target = petEventTarget()
  if (!target || typeof CustomEvent === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PetEventDetail>).detail
    if (detail) handler(detail)
  }
  target.addEventListener(PET_EVENT, listener)
  return () => target.removeEventListener(PET_EVENT, listener)
}

// ---- 消息队列 ----

/** 队列上限防止长时间不操作时气泡无限堆积；超出丢弃最旧的。 */
export const PET_QUEUE_LIMIT = 4

let petSeq = 0

export function nextPetMessageId(): string {
  petSeq += 1
  return `petmsg-${Date.now().toString(36)}-${petSeq}`
}

export function enqueuePetMessage(queue: PetMessage[], message: Omit<PetMessage, 'id'> & { id?: string }): PetMessage[] {
  const merged = [...queue, { id: message.id ?? nextPetMessageId(), ...message } as PetMessage]
  return merged.length > PET_QUEUE_LIMIT ? merged.slice(merged.length - PET_QUEUE_LIMIT) : merged
}

/** 气泡停留时长：按文字长度估算，保证自动换行后有足够阅读时间。 */
export function petMessageDuration(text: string): number {
  return Math.min(14000, Math.max(4500, 2200 + text.length * 240))
}

// ---- 文案（随机模板，让宠物显得活而不吵） ----

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

const TASK_GREETINGS = [
  '该开始学习「{name}」啦！',
  '「{name}」的时间到了哦～',
  '叮！到「{name}」的时间啦，芽芽陪你一起！',
]

export function petTaskGreeting(name: string, lateMinutes = 0): string {
  const base = pick(TASK_GREETINGS).replaceAll('{name}', name)
  return lateMinutes >= 1 ? `${base}这条提醒迟到了约 ${lateMinutes} 分钟，现在开始也来得及！` : base
}

export function petTaskDoneReply(name: string): string {
  return pick([
    `「${name}」完成！记得的每一题都会变成分数回来找你～`,
    `「${name}」打卡完成，芽芽给你比个👍`,
  ])
}

export function petTaskSnoozeReply(name: string): string {
  return `好，「${name}」先延后 5 分钟，芽芽到点再喊你。`
}

export function petTaskDismissReply(name: string): string {
  return `这次先忽略「${name}」，下次别忘了哦。`
}

export function petStudyStartReply(): string {
  return pick([
    '芽芽在旁边陪你思考，慢慢来～',
    '讲题开始！芽芽也在认真听～',
    '别急，一步一步来，芽芽陪你想。',
  ])
}

export function petStudyDoneReply(): string {
  return pick([
    '讲完啦！把最终答案再默数一遍，就是你的了。',
    '搞定！错过的地方记得回看「易错点」～',
    '又进一步！芽芽为你高兴。',
  ])
}

export function petIdleEncouragement(): string {
  return pick([
    '学了这么久，起来喝口水，看看远处休息一下吧。',
    '芽芽陪着你呢，累了就歇 5 分钟再战。',
    '坚持到现在已经很棒了，下一题慢慢来。',
    '眼睛累了吗？眨眨眼，我们再继续。',
  ])
}

// ---- 闲置检测 ----

/** 超过这段时间没有任何输入且页面可见，芽芽会说一句鼓励的话。 */
export const PET_IDLE_MS = 90_000
/** 鼓励话术的最小间隔，避免挂机时刷屏。 */
export const PET_IDLE_REPEAT_MS = 5 * 60_000

export function shouldPromptIdle(lastActiveAt: number, lastPromptAt: number, now: number): boolean {
  return now - lastActiveAt >= PET_IDLE_MS && now - lastPromptAt >= PET_IDLE_REPEAT_MS
}

// ---- 位置 ----

/** 拖动或窗口尺寸变化后，把浮窗位置收敛在视口内。 */
export function clampPetPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(0, viewportWidth - width)
  const maxY = Math.max(0, viewportHeight - height)
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  }
}

// ---- 宠物生物(creature)角色与行为状态机 ----
// 宠物是"活的":在地面踱步、张望、坐下、打盹,而不是静态图标。

import type { AvatarKind } from '../types'

export type CreatureState = 'walk' | 'look' | 'sit' | 'sleep' | 'excited' | 'remind' | 'think'

export interface CreatureProfile {
  id: AvatarKind
  name: string
  trait: string
  body: string
  belly: string
  ear: 'sprout' | 'cat' | 'rabbit' | 'bear'
  /** 走路速度 px/s,性格不同快慢不同 */
  speed: number
}

export const CREATURES: Record<AvatarKind, CreatureProfile> = {
  sprout: { id: 'sprout', name: '芽芽', trait: '元气满满的小豆芽,最爱陪你解题', body: '#8FE3C8', belly: '#79D5B9', ear: 'sprout', speed: 46 },
  cat: { id: 'cat', name: '团团', trait: '好奇心旺盛的小橘猫,走两步就要东张西望', body: '#FFC069', belly: '#F5A940', ear: 'cat', speed: 62 },
  rabbit: { id: 'rabbit', name: '雪球', trait: '安安静静的小雪兔,经常坐着发呆想事情', body: '#FFB1C6', belly: '#F99BB4', ear: 'rabbit', speed: 40 },
  bear: { id: 'bear', name: '布丁', trait: '慢悠悠的小熊,走着走着就犯困打盹', body: '#D8A86F', belly: '#C7945C', ear: 'bear', speed: 34 },
}

export const CREATURE_ORDER: AvatarKind[] = ['sprout', 'cat', 'rabbit', 'bear']

/** 行为链:走路后多半张望,张望后继续走或坐下,坐久打盹——循环往复像真的一样。 */
export function nextCreatureState(current: CreatureState, roll: number): CreatureState {
  const r = Math.floor(roll * 100)
  switch (current) {
    case 'walk':
      return r < 55 ? 'look' : r < 75 ? 'sit' : r < 88 ? 'sleep' : 'walk'
    case 'look':
      return r < 60 ? 'walk' : r < 85 ? 'sit' : 'look'
    case 'sit':
      return r < 45 ? 'walk' : r < 80 ? 'sleep' : 'look'
    case 'sleep':
      return r < 70 ? 'walk' : 'sit'
    default:
      return 'walk'
  }
}

/** 每个状态的持续时间(ms):走路久一点,打盹更长。 */
export function creatureStateDuration(state: CreatureState, roll: number): number {
  switch (state) {
    case 'walk':
      return 2600 + roll * 3400
    case 'look':
      return 1600 + roll * 1800
    case 'sit':
      return 2400 + roll * 2600
    case 'sleep':
      return 4200 + roll * 4600
    case 'excited':
      return 1400
    default:
      return 2400
  }
}

/** 随机下一个踱步目标点:与当前位置至少隔开一段距离,来回走才自然。 */
export function nextWalkTarget(x: number, viewportWidth: number, margin = 70): number {
  const low = margin
  const high = Math.max(margin + 40, viewportWidth - margin)
  let target = margin + Math.random() * (high - low)
  if (Math.abs(target - x) < 120) target = x < (low + high) / 2 ? high - Math.random() * 100 : low + Math.random() * 100
  return Math.min(high, Math.max(low, target))
}

/** 走路推进:按速度逼近目标,返回新位置与是否到达。 */
export function advanceCreature(x: number, target: number, speed: number, dtMs: number): { x: number; arrived: boolean } {
  const step = (speed * dtMs) / 1000
  const delta = target - x
  if (Math.abs(delta) <= step) return { x: target, arrived: true }
  return { x: x + Math.sign(delta) * step, arrived: false }
}

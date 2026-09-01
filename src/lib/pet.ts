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

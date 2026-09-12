// 在线会议实时层
//
// 架构:UI 层只依赖 MeetingSession;真正的传输由 RtcDriver 接口注入。
// 当前实现 BroadcastChannelDriver —— 同一设备上开两个标签页(主讲人/参会者)即可
// 全流程真实联调:进会、静音、聊天、白板同步、结束会议。
// 接入真实服务时实现 WebSocketDriver 或 WebRTCDriver(sendWebSocketDriver 骨架已给出,
// 信令服务器建议:rooms/{id} 房间状态 + WebSocket 广播),UI 层零改动。
import type { BoardItem, BoardPage, MeetingChatMsg, MeetingInfo, MeetingParticipant, MeetingRoomState } from '../types'
import { uid } from '../lib/misc'

const REGISTRY_KEY = 'zsb_meetings_v1'

export interface RtcAction {
  kind:
    | 'join' // { participant }
    | 'leave' // { userId }
    | 'mic' // { userId, on }
    | 'cam' // { userId, on }
    | 'chat' // { msg }
    | 'board-add' // { pageId, items }
    | 'board-replace' // { pageId, items }
    | 'page-add' // { page }
    | 'page-remove' // { pageId }
    | 'page-active' // { pageId }
    | 'page-bg' // { pageId, bgImage }
    | 'page-grid' // { pageId, grid }
    | 'mute-all'
    | 'set-mic' // host: { userId, on }
    | 'set-speak' // host: { userId, on }
    | 'set-edit' // host: { userId, on }
    | 'raise-hand' // { userId, on }
    | 'share-frame' // 屏幕共享一帧贴白板: { userId, dataUrl }
    | 'end'
    | '__room' // 主机 → 全员:房间状态快照(内部)
    | 'board' // 白板增量/整体替换(内部)
  [k: string]: unknown
}

export interface RtcHandlers {
  onRoomState: (s: MeetingRoomState) => void
  onChat: (m: MeetingChatMsg) => void
  onBoardDelta: (pageId: string, items: BoardItem[], replace: boolean) => void
}

export interface RtcDriver {
  connect(meetingId: string, handlers: RtcHandlers): void
  disconnect(): void
  /** action 上行(本地驱动=广播;服务器驱动=发给信令服务) */
  send(action: RtcAction): void
}

/** WebSocket 驱动骨架:接入真实服务器时补齐 url 协议即可 */
export function createWebSocketDriver(url: string): RtcDriver {
  return {
    connect() {
      throw new Error(`WebSocket 会议服务未部署:${url}(RtcDriver 接口已就绪,见 services/rtc.ts)`)
    },
    disconnect() {},
    send() {},
  }
}

// ---------- 会议登记表(会议列表/历史/房间状态持久化) ----------

interface MeetingRegistry {
  meetings: MeetingInfo[]
  rooms: Record<string, MeetingRoomState>
}

function loadRegistry(): MeetingRegistry {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    if (raw) return JSON.parse(raw) as MeetingRegistry
  } catch {
    // ignore
  }
  return { meetings: [], rooms: {} }
}

function saveRegistry(r: MeetingRegistry): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(r))
  } catch {
    // 配额不足时仅放弃持久化,房间仍在内存中可用
  }
}

export function listMeetings(): MeetingInfo[] {
  return loadRegistry().meetings.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getMeeting(id: string): MeetingInfo | null {
  return loadRegistry().meetings.find((m) => m.id === id) ?? null
}

export function upsertMeeting(meeting: MeetingInfo): void {
  const r = loadRegistry()
  const i = r.meetings.findIndex((m) => m.id === meeting.id)
  if (i >= 0) r.meetings[i] = meeting
  else r.meetings.unshift(meeting)
  saveRegistry(r)
}

export function createMeeting(input: { title: string; hostId: string; hostName: string; startAt: string; plannedMinutes: number; postId?: string }): MeetingInfo {
  const meeting: MeetingInfo = {
    id: uid('mt'),
    title: input.title.trim() || '答疑会议',
    hostId: input.hostId,
    hostName: input.hostName,
    postId: input.postId,
    startAt: input.startAt,
    plannedMinutes: input.plannedMinutes,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
  }
  upsertMeeting(meeting)
  return meeting
}

// ---------- 会议会话(主机权威模型) ----------

/** 首页 id 由会议 id 确定性推导:参会者在主机首次持久化前进入,两端页面 id 也能对上 */
function firstPage(meetingId: string): BoardPage {
  return { id: `bp_${meetingId}_0`, items: [] }
}

export class MeetingSession {
  private driver: RtcDriver | null = null
  private handlers: RtcHandlers | null = null
  private room: MeetingRoomState
  private me: { id: string; name: string }
  private isHost: boolean
  private listeners = new Set<(s: MeetingRoomState) => void>()
  private chatLog: MeetingChatMsg[] = []
  private chatListeners = new Set<(list: MeetingChatMsg[]) => void>()
  private persistTimer: number | undefined

  constructor(opts: { meeting: MeetingInfo; me: { id: string; name: string }; isHost: boolean; driver?: RtcDriver }) {
    this.me = opts.me
    this.isHost = opts.isHost
    this.driver = opts.driver ?? createDefaultDriver()
    const reg = loadRegistry()
    const saved = reg.rooms[opts.meeting.id]
    this.room = saved ?? {
      meeting: opts.isHost ? { ...opts.meeting, status: 'live' } : opts.meeting,
      participants: [],
      pages: [firstPage(opts.meeting.id)],
      activePageId: '',
    }
    if (!this.room.activePageId) this.room.activePageId = this.room.pages[0].id
    if (this.isHost) {
      this.room.meeting.status = 'live'
      upsertMeeting(this.room.meeting)
      if (!this.room.participants.some((p) => p.userId === opts.me.id)) {
        this.room.participants.push({
          userId: opts.me.id,
          name: opts.me.name,
          role: 'host',
          micOn: true,
          camOn: false,
          canSpeak: true,
          joinedAt: new Date().toISOString(),
        })
      }
    }
  }

  // ---- 生命周期 ----

  start(): void {
    this.handlers = {
      onRoomState: (s) => {
        if (this.isHost) return // 主机权威:忽略远端房间状态(同账号双开互不污染)
        this.room = s
        this.emit()
      },
      onChat: (m) => {
        this.chatLog = [...this.chatLog, m]
        this.chatListeners.forEach((f) => f(this.chatLog))
      },
      onBoardDelta: (pageId, items, replace) => {
        const page = this.room.pages.find((p) => p.id === pageId)
        if (!page) return
        const nextItems = replace ? [...items] : [...page.items, ...items.filter((i) => !page.items.some((x) => x.id === i.id))]
        this.room = {
          ...this.room,
          pages: this.room.pages.map((candidate) => candidate.id === pageId ? { ...candidate, items: nextItems } : candidate),
        }
        this.emit()
      },
    }
    this.driver!.connect(this.room.meeting.id, this.handlers)
    if (this.isHost) {
      setIntentHandler((a) => this.hostApply(a))
      this.broadcastRoom()
    } else this.driver!.send({ kind: 'join', participant: this.meAsParticipant() })
    this.schedulePersist()
  }

  stop(): void {
    if (!this.isHost && this.driver) this.driver.send({ kind: 'leave', userId: this.me.id })
    this.driver?.disconnect()
    this.driver = null
    if (this.isHost) setIntentHandler(null)
    if (this.persistTimer) window.clearTimeout(this.persistTimer)
    this.persist()
  }

  private meAsParticipant(): MeetingParticipant {
    return {
      userId: this.me.id,
      name: this.me.name,
      role: 'guest',
      micOn: false,
      camOn: false,
      canSpeak: false,
      joinedAt: new Date().toISOString(),
    }
  }

  // ---- 状态读取 / 订阅 ----

  get snapshot(): MeetingRoomState {
    return this.room
  }

  get chat(): MeetingChatMsg[] {
    return this.chatLog
  }

  subscribe(cb: (s: MeetingRoomState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  subscribeChat(cb: (list: MeetingChatMsg[]) => void): () => void {
    this.chatListeners.add(cb)
    cb(this.chatLog)
    return () => this.chatListeners.delete(cb)
  }

  private emit(): void {
    this.listeners.forEach((f) => f(this.room))
  }

  private isEditor(userId: string): boolean {
    return this.room.meeting.hostId === userId || this.room.editorsAccess?.includes(userId) === true
  }

  /** 供驱动层把远端参会者意图送进主机(仅主机生效);测试驱动也用它连线 */
  handleRemoteIntent(a: RtcAction): void {
    this.hostApply(a)
  }

  // ---- 主机控制 ----

  private hostApply(action: RtcAction): void {
    if (!this.isHost) return
    const room = this.room
    let parts = room.participants
    switch (action.kind) {
      case 'join': {
        const p = action.participant as MeetingParticipant
        if (!parts.some((x) => x.userId === p.userId)) {
          parts.push(p)
          this.pushSystemChat(`${p.name} 加入了会议`)
        }
        break
      }
      case 'leave': {
        const p = parts.find((x) => x.userId === action.userId)
        parts = parts.filter((x) => x.userId !== action.userId)
        room.participants = parts
        if (p) this.pushSystemChat(`${p.name} 离开了会议`)
        break
      }
      case 'mic': {
        const p = parts.find((x) => x.userId === action.userId)
        if (p && (p.canSpeak || p.role === 'host')) p.micOn = !!action.on
        break
      }
      case 'cam': {
        const p = parts.find((x) => x.userId === action.userId)
        if (p) p.camOn = !!action.on
        break
      }
      case 'mute-all':
        for (const p of parts) if (p.role !== 'host') p.micOn = false
        this.pushSystemChat('主讲人已全体静音')
        break
      case 'set-mic': {
        const p = parts.find((x) => x.userId === action.userId)
        if (p) {
          p.micOn = !!action.on
          this.pushSystemChat(`主讲人已${action.on ? '解除' : ''}静音 ${p.name}`)
        }
        break
      }
      case 'set-speak': {
        const p = parts.find((x) => x.userId === action.userId)
        if (p) {
          p.canSpeak = !!action.on
          if (!p.canSpeak) p.micOn = false
          this.pushSystemChat(`主讲人${action.on ? '允许' : '禁止'} ${p.name} 发言`)
        }
        break
      }
      case 'set-edit': {
        const editors = room.editorsAccess ?? []
        const uid2 = action.userId as string
        const next = editors.includes(uid2) ? editors.filter((x) => x !== uid2) : [...editors, uid2]
        this.room = { ...room, editorsAccess: next }
        break
      }
      case 'chat':
        // 由 sendChat 直接处理
        break
      case 'raise-hand': {
        const p = parts.find((x) => x.userId === action.userId)
        if (p) {
          p.handRaised = !!action.on
          this.pushSystemChat(`${p.name} ${action.on ? '举手了 🙋' : '放下了手'}`)
        }
        break
      }
      case 'share-frame': {
        // 屏幕共享帧由系统允许贴板(等价于希沃"截图讲题"),不受白板只读限制
        const page = room.pages.find((pg) => pg.id === room.activePageId) ?? room.pages[0]
        if (page && typeof action.dataUrl === 'string') {
          const wx = typeof action.wx === 'number' ? action.wx : 0.08
          const wy = typeof action.wy === 'number' ? action.wy : 0.06
          page.items = [
            ...page.items,
            { id: uid('bi'), type: 'image', pts: [wx, wy, 0.84, 0.84 * (9 / 16)], color: '#000', width: 0, src: action.dataUrl, by: action.userId as string, at: Date.now() },
          ]
          const who = parts.find((x) => x.userId === action.userId)?.name ?? '参会者'
          this.pushSystemChat(`${who} 共享了一帧屏幕到白板`)
        }
        break
      }
      case 'end':
        room.meeting.status = 'ended'
        room.endedAt = new Date().toISOString()
        this.pushSystemChat('会议已结束')
        break
      default:
        this.applyBoard(action)
    }
    this.broadcastRoom()
  }

  private applyBoard(action: RtcAction): void {
    const room = this.room
    let next: MeetingRoomState | null = null
    switch (action.kind) {
      case 'board-add': {
        const page = room.pages.find((p) => p.id === action.pageId)
        if (page) {
          const additions = action.items as BoardItem[]
          next = {
            ...room,
            pages: room.pages.map((candidate) => candidate.id === action.pageId
              ? { ...candidate, items: [...candidate.items, ...additions] }
              : candidate),
          }
        }
        break
      }
      case 'board-replace': {
        const page = room.pages.find((p) => p.id === action.pageId)
        if (page) {
          next = {
            ...room,
            pages: room.pages.map((candidate) => candidate.id === action.pageId
              ? { ...candidate, items: [...(action.items as BoardItem[])] }
              : candidate),
          }
        }
        break
      }
      case 'page-add': {
        const page = action.page as BoardPage
        if (!room.pages.some((candidate) => candidate.id === page.id)) {
          next = { ...room, pages: [...room.pages, page], activePageId: page.id }
        }
        break
      }
      case 'page-remove': {
        if (room.pages.length <= 1) return
        const pages = room.pages.filter((candidate) => candidate.id !== action.pageId)
        next = { ...room, pages, activePageId: room.activePageId === action.pageId ? pages[0].id : room.activePageId }
        break
      }
      case 'page-active':
        if (room.pages.some((candidate) => candidate.id === action.pageId)) next = { ...room, activePageId: action.pageId as string }
        break
      case 'page-bg': {
        if (room.pages.some((candidate) => candidate.id === action.pageId)) {
          next = { ...room, pages: room.pages.map((candidate) => candidate.id === action.pageId ? { ...candidate, bgImage: action.bgImage as string | undefined } : candidate) }
        }
        break
      }
      case 'page-grid': {
        if (room.pages.some((candidate) => candidate.id === action.pageId)) {
          next = { ...room, pages: room.pages.map((candidate) => candidate.id === action.pageId ? { ...candidate, grid: action.grid as 'grid' | 'lines' | undefined } : candidate) }
        }
        break
      }
    }
    if (next) this.room = next
  }

  private broadcastRoom(): void {
    if (this.isHost) {
      this.driver?.send({ kind: '__room', state: this.room } as RtcAction)
      this.emit()
    }
  }

  // ---- 对外操作(UI 调用) ----

  toggleMyMic(on: boolean): void {
    if (this.isHost) this.hostApply({ kind: 'mic', userId: this.me.id, on })
    else this.driver?.send({ kind: 'mic', userId: this.me.id, on })
  }

  toggleMyCam(on: boolean): void {
    if (this.isHost) this.hostApply({ kind: 'cam', userId: this.me.id, on })
    else this.driver?.send({ kind: 'cam', userId: this.me.id, on })
  }

  muteAll(): void {
    if (this.isHost) this.hostApply({ kind: 'mute-all' })
  }

  raiseHand(on: boolean): void {
    if (this.isHost) this.hostApply({ kind: 'raise-hand', userId: this.me.id, on })
    else this.driver?.send({ kind: 'raise-hand', userId: this.me.id, on })
  }

  /** 屏幕共享:抓一帧贴到当前白板页(任何人可用,主机收敛状态;wx/wy=世界坐标落点) */
  shareFrameToBoard(dataUrl: string, wx?: number, wy?: number): void {
    if (this.isHost) this.hostApply({ kind: 'share-frame', userId: this.me.id, dataUrl, wx, wy })
    else this.driver?.send({ kind: 'share-frame', userId: this.me.id, dataUrl, wx, wy })
  }

  setParticipantMic(userId: string, on: boolean): void {
    if (this.isHost) this.hostApply({ kind: 'set-mic', userId, on })
  }

  setParticipantSpeak(userId: string, on: boolean): void {
    if (this.isHost) this.hostApply({ kind: 'set-speak', userId, on })
  }

  setParticipantEdit(userId: string, on: boolean): void {
    if (this.isHost) this.hostApply({ kind: 'set-edit', userId, on })
  }

  endMeeting(): void {
    if (this.isHost) this.hostApply({ kind: 'end' })
  }

  sendChat(body: string): void {
    const text = body.trim()
    if (!text) return
    const msg: MeetingChatMsg = { id: uid('mc'), from: this.me.id, name: this.me.name, body: text, at: new Date().toISOString() }
    this.chatLog = [...this.chatLog, msg]
    this.chatListeners.forEach((f) => f(this.chatLog))
    this.driver?.send({ kind: 'chat', msg } as RtcAction)
  }

  private pushSystemChat(text: string): void {
    const msg: MeetingChatMsg = { id: uid('mc'), from: '__sys', name: '系统', body: text, at: new Date().toISOString() }
    this.chatLog = [...this.chatLog, msg]
    this.chatListeners.forEach((f) => f(this.chatLog))
    this.driver?.send({ kind: 'chat', msg } as RtcAction)
  }

  canEditBoard(userId: string): boolean {
    if (this.room.meeting.hostId === userId) return true
    return (this.room.editorsAccess ?? []).includes(userId)
  }

  addBoardItems(pageId: string, items: BoardItem[]): void {
    if (!this.canEditBoard(this.me.id)) return
    if (this.isHost) {
      this.applyBoard({ kind: 'board-add', pageId, items })
      this.broadcastRoom()
      this.driver?.send({ kind: 'board', pageId, items, replace: false } as RtcAction)
    } else {
      this.driver?.send({ kind: 'board-add', pageId, items })
      // 本地立即生效,不等回包(主观感受一致,状态由主机收敛)
      this.applyBoard({ kind: 'board-add', pageId, items })
      this.emit()
    }
  }

  replaceBoardPage(pageId: string, items: BoardItem[]): void {
    if (!this.canEditBoard(this.me.id)) return
    if (this.isHost) {
      this.applyBoard({ kind: 'board-replace', pageId, items })
      this.broadcastRoom()
      this.driver?.send({ kind: 'board', pageId, items, replace: true } as RtcAction)
    } else {
      this.driver?.send({ kind: 'board-replace', pageId, items })
      this.applyBoard({ kind: 'board-replace', pageId, items })
      this.emit()
    }
  }

  addPage(): void {
    if (!this.canEditBoard(this.me.id)) return
    const page = { id: uid('bp'), items: [] }
    if (this.isHost) {
      this.applyBoard({ kind: 'page-add', page })
      this.broadcastRoom()
    } else this.driver?.send({ kind: 'page-add', page })
  }

  removePage(pageId: string): void {
    if (!this.canEditBoard(this.me.id)) return
    if (this.isHost) {
      this.applyBoard({ kind: 'page-remove', pageId })
      this.broadcastRoom()
    } else this.driver?.send({ kind: 'page-remove', pageId })
  }

  setActivePage(pageId: string): void {
    if (this.isHost) {
      this.applyBoard({ kind: 'page-active', pageId })
      this.broadcastRoom()
    } else this.driver?.send({ kind: 'page-active', pageId })
  }

  setPageBg(pageId: string, bgImage: string | undefined): void {
    if (!this.canEditBoard(this.me.id)) return
    if (this.isHost) {
      this.applyBoard({ kind: 'page-bg', pageId, bgImage })
      this.broadcastRoom()
    } else this.driver?.send({ kind: 'page-bg', pageId, bgImage })
  }

  setPageGrid(pageId: string, grid: 'grid' | 'lines' | undefined): void {
    if (!this.canEditBoard(this.me.id)) return
    if (this.isHost) {
      this.applyBoard({ kind: 'page-grid', pageId, grid })
      this.broadcastRoom()
    } else this.driver?.send({ kind: 'page-grid', pageId, grid })
  }

  /** 立即持久化房间状态("保存白板"按钮) */
  saveNow(): void {
    this.persist()
  }

  /** 房间状态持久化(刷新后白板不丢;主讲人负责) */
  private schedulePersist(): void {
    if (this.persistTimer) window.clearInterval(this.persistTimer)
    this.persistTimer = window.setInterval(() => this.persist(), 4000)
  }

  private persist(): void {
    const r = loadRegistry()
    r.rooms[this.room.meeting.id] = this.room
    const i = r.meetings.findIndex((m) => m.id === this.room.meeting.id)
    if (i >= 0) r.meetings[i] = this.room.meeting
    saveRegistry(r)
  }
}

// ---------- BroadcastChannel 本机驱动 ----------

type BcMessage = { t: 'intent'; action: RtcAction } | { t: 'room'; state: MeetingRoomState } | { t: 'chat'; msg: MeetingChatMsg } | { t: 'board'; pageId: string; items: BoardItem[]; replace: boolean }

export class BroadcastChannelDriver implements RtcDriver {
  private ch: BroadcastChannel | null = null
  private handlers: RtcHandlers | null = null
  private isHost = false

  connect(meetingId: string, handlers: RtcHandlers): void {
    this.handlers = handlers
    this.isHost = false // 驱动本身不区分;主机通过 send('__room') 分发状态
    this.ch = new BroadcastChannel(`zsb-mrtc-${meetingId}`)
    this.ch.onmessage = (e: MessageEvent<BcMessage>) => {
      const m = e.data
      if (m.t === 'room') handlers.onRoomState(m.state)
      else if (m.t === 'chat') handlers.onChat(m.msg)
      else if (m.t === 'board') handlers.onBoardDelta(m.pageId, m.items, m.replace)
      else if (m.t === 'intent') forwardIntent(m.action, handlers)
    }
  }

  send(action: RtcAction): void {
    if (!this.ch) return
    if (action.kind === '__room') {
      this.ch.postMessage({ t: 'room', state: action.state as MeetingRoomState } satisfies BcMessage)
    } else if (action.kind === 'chat') {
      this.ch.postMessage({ t: 'chat', msg: action.msg as MeetingChatMsg } satisfies BcMessage)
    } else if (action.kind === 'board') {
      this.ch.postMessage({ t: 'board', pageId: action.pageId as string, items: action.items as BoardItem[], replace: !!action.replace } satisfies BcMessage)
    } else {
      this.ch.postMessage({ t: 'intent', action } satisfies BcMessage)
    }
  }

  disconnect(): void {
    this.ch?.close()
    this.ch = null
  }
}

/** 意图处理:非主机收到 intent 时忽略(主机权威);主机在 MeetingSession 里覆写处理 */
let intentHandler: ((a: RtcAction) => void) | null = null

export function setIntentHandler(h: ((a: RtcAction) => void) | null): void {
  intentHandler = h
}

function forwardIntent(action: RtcAction, handlers: RtcHandlers): void {
  void handlers
  if (intentHandler) intentHandler(action)
}


// ---------- Supabase Realtime 驱动(rtc_message 表,跨设备) ----------
//
// 发送:REST insert rtc_message{room_id, sender_uid:null, payload}。
//   sender_uid 是 auth.users 的外键,本项目用自有账号体系,故恒为 null,身份放 payload.client_id。
// 接收:postgres_changes INSERT 订阅(RLS 对 anon 只读已放行),按 payload.t 分发:
//   room → onRoomState(主机快照) / chat → onChat / board → onBoardDelta / intent → 主机 intentHandler。
// 回声过滤:payload.client_id 与本端相同的事件丢弃。

import { getSupabase } from './supabaseClient'

export interface RtcWireMessage {
  t: 'room' | 'chat' | 'board' | 'intent'
  client_id: string
  // 各类型的具体载荷:
  state?: MeetingRoomState
  msg?: MeetingChatMsg
  pageId?: string
  items?: BoardItem[]
  replace?: boolean
  action?: RtcAction
}

export class SupabaseRealtimeDriver implements RtcDriver {
  private handlers: RtcHandlers | null = null
  private channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>['channel']> | null = null
  private meetingId = ''
  readonly clientId = uid('cli')
  /** 构建时缺 Supabase 环境变量时,自动降级为本机 BroadcastChannel(绝不崩溃) */
  private fallback = new BroadcastChannelDriver()

  connect(meetingId: string, handlers: RtcHandlers): void {
    const supabase = getSupabase()
    if (!supabase) {
      this.fallback.connect(meetingId, handlers)
      return
    }
    this.handlers = handlers
    this.meetingId = meetingId
    this.channel = supabase
      .channel(`room-${meetingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rtc_message', filter: `room_id=eq.${meetingId}` },
        (ev) => {
          const wire = (ev.new as { payload?: RtcWireMessage })?.payload
          if (!wire || !this.shouldProcess(wire)) return // 过滤自己的回声
          this.dispatch(wire)
        }
      )
      .subscribe()
  }

  /** 回声判定:别人的消息才处理(独立出来便于单测) */
  shouldProcess(wire: RtcWireMessage | null | undefined): boolean {
    return !!wire && wire.client_id !== this.clientId
  }

  /** 单条线上消息 → 本地回调(独立出来便于单测) */
  dispatch(wire: RtcWireMessage): void {
    const h = this.handlers
    if (!h) return
    if (wire.t === 'room' && wire.state) h.onRoomState(wire.state)
    else if (wire.t === 'chat' && wire.msg) h.onChat(wire.msg)
    else if (wire.t === 'board' && wire.pageId) h.onBoardDelta(wire.pageId, wire.items ?? [], !!wire.replace)
    else if (wire.t === 'intent' && wire.action) forwardIntent(wire.action, h)
  }

  private async publish(wire: RtcWireMessage): Promise<void> {
    const supabase = getSupabase()
    if (!supabase) return
    await supabase.from('rtc_message').insert({ room_id: this.meetingId, sender_uid: null, payload: { ...wire, client_id: this.clientId } })
  }

  send(action: RtcAction): void {
    if (!getSupabase()) {
      this.fallback.send(action)
      return
    }
    if (action.kind === '__room') {
      void this.publish({ t: 'room', client_id: this.clientId, state: action.state as MeetingRoomState })
    } else if (action.kind === 'chat') {
      void this.publish({ t: 'chat', client_id: this.clientId, msg: action.msg as MeetingChatMsg })
    } else if (action.kind === 'board') {
      const a = action as unknown as { pageId: string; items: BoardItem[]; replace: boolean }
      void this.publish({ t: 'board', client_id: this.clientId, pageId: a.pageId, items: a.items, replace: a.replace })
    } else {
      void this.publish({ t: 'intent', client_id: this.clientId, action })
    }
  }

  disconnect(): void {
    const supabase = getSupabase()
    if (supabase && this.channel) supabase.removeChannel(this.channel)
    else this.fallback.disconnect()
    this.channel = null
    this.handlers = null
  }

  /** 当前频道订阅状态(subscribed 为正常;F12/测试验证用) */
  get channelState(): string {
    return this.channel?.state ?? 'closed'
  }
}

/** 驱动工厂:配置了 Supabase 用云端驱动(跨设备),否则回退本机 BroadcastChannel;globalThis 可覆盖 */
export function createDefaultDriver(): RtcDriver {
  const injected = (globalThis as Record<string, unknown>).rtcDriver as RtcDriver | (() => RtcDriver) | undefined
  if (injected) return typeof injected === 'function' ? (injected as () => RtcDriver)() : injected
  if (getSupabase()) return new SupabaseRealtimeDriver()
  return new BroadcastChannelDriver()
}

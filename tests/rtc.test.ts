// 会议实时层测试:用内存总线驱动 host/guest 两个会话,验证主机权威同步
import { describe, expect, it, vi } from 'vitest'
import { MeetingSession, createMeeting, ensureMeetingFromInvite, getMeeting, setIntentHandler } from '../src/services/rtc'
import type { RtcAction, RtcDriver, RtcHandlers } from '../src/services/rtc'
import type { MeetingInfo } from '../src/types'

// node 测试环境补最小 window/localStorage(rtc 内部用于持久化与定时器)
const mem = new Map<string, string>()
vi.stubGlobal('window', {
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
})
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
})

/** 内存驱动:__room/chat/board 分发给其他端;intent 由测试连线送进主机 */
class FakeDriver implements RtcDriver {
  handlers: RtcHandlers | null = null
  onIntent: (a: RtcAction) => void = () => {}
  private static all = new Set<FakeDriver>()

  connect(_meetingId: string, handlers: RtcHandlers): void {
    this.handlers = handlers
    FakeDriver.all.add(this)
  }
  disconnect(): void {
    FakeDriver.all.delete(this)
  }
  send(action: RtcAction): void {
    if (action.kind === '__room') {
      for (const d of FakeDriver.all) if (d !== this) d.handlers?.onRoomState((action as { state: never }).state)
    } else if (action.kind === 'chat') {
      for (const d of FakeDriver.all) if (d !== this) d.handlers?.onChat((action as { msg: never }).msg)
    } else if (action.kind === 'board') {
      for (const d of FakeDriver.all) {
        if (d !== this) d.handlers?.onBoardDelta(action.pageId as string, (action.items as never) ?? [], !!action.replace, action.eraseUpdates as never)
      }
    } else {
      this.onIntent(action)
    }
  }
}

const HOST = { id: 'u_host', name: '主讲' }
const GUEST = { id: 'u_guest', name: '参会者' }

function setup() {
  const meeting: MeetingInfo = createMeeting({ title: '测试会议', hostId: HOST.id, hostName: HOST.name, startAt: new Date().toISOString(), plannedMinutes: 30 })
  const hostDriver = new FakeDriver()
  const guestDriver = new FakeDriver()
  const host = new MeetingSession({ meeting, me: HOST, isHost: true, driver: hostDriver })
  hostDriver.onIntent = (a) => host.handleRemoteIntent(a)
  const guest = new MeetingSession({ meeting, me: GUEST, isHost: false, driver: guestDriver })
  guestDriver.onIntent = (a) => host.handleRemoteIntent(a)
  host.start()
  guest.start()
  return { meeting, host, guest, hostDriver, guestDriver }
}

describe('会议实时层(主机权威)', () => {
  it('参会者加入后主机可见,离开后移除', () => {
    const { host, guest } = setup()
    expect(host.snapshot.participants.map((p) => p.name)).toEqual(['主讲', '参会者'])
    expect(guest.snapshot.participants).toHaveLength(2)
    guest.stop()
    expect(host.snapshot.participants.map((p) => p.name)).toEqual(['主讲'])
  })

  it('聊天双向即时到达', () => {
    const { host, guest } = setup()
    guest.sendChat('听不懂,再讲一遍')
    expect(host.chat.at(-1)?.body).toBe('听不懂,再讲一遍')
    host.sendChat('好,我们从头讲')
    expect(guest.chat.at(-1)?.body).toBe('好,我们从头讲')
  })

  it('guest 默认只读,主机授权编辑后笔迹才同步;静音/结束会议全员生效', () => {
    const { host, guest } = setup()
    const pageId = guest.snapshot.pages[0].id
    // 普通参会者默认只读:未授权时笔迹被忽略
    guest.addBoardItems(pageId, [{ id: 'bi1', type: 'pen', pts: [0.1, 0.1, 0.5, 0.5], color: '#000', width: 3, by: GUEST.id, at: Date.now() }])
    expect(host.snapshot.pages[0].items.some((i) => i.id === 'bi1')).toBe(false)
    // 主机授权编辑后同步
    host.setParticipantEdit(GUEST.id, true)
    guest.addBoardItems(pageId, [{ id: 'bi1', type: 'pen', pts: [0.1, 0.1, 0.5, 0.5], color: '#000', width: 3, by: GUEST.id, at: Date.now() }])
    expect(host.snapshot.pages[0].items.some((i) => i.id === 'bi1')).toBe(true)
    // 主机授权发言后 guest 的麦克风意图才被接受
    host.setParticipantSpeak(GUEST.id, true)
    guest.toggleMyMic(true)
    expect(host.snapshot.participants.find((p) => p.userId === GUEST.id)?.micOn).toBe(true)
    host.muteAll()
    expect(guest.snapshot.participants.find((p) => p.userId === GUEST.id)?.micOn).toBe(false)
    // 收回发言权后再开麦:被主机拒绝
    host.setParticipantSpeak(GUEST.id, false)
    guest.toggleMyMic(true)
    expect(host.snapshot.participants.find((p) => p.userId === GUEST.id)?.micOn).toBe(false)
  })

  it('主机本地替换白板立即产生新快照,橡皮擦不会依赖 React 原地变更', () => {
    const { host } = setup()
    const pageId = host.snapshot.pages[0].id
    const beforeRoom = host.snapshot
    host.addBoardItems(pageId, [{ id: 'erase-target', type: 'pen', pts: [0.1, 0.1, 0.5, 0.5], color: '#000', width: 3, by: HOST.id, at: Date.now() }])
    const beforeReplace = host.snapshot
    const partial = { id: 'erase-target', type: 'pen' as const, pts: [0.1, 0.1, 0.5, 0.5], color: '#000', width: 3, erasePoints: [{ x: 0.3, y: 0.3, r: 0.02 }], by: HOST.id, at: Date.now() }
    host.replaceBoardPage(pageId, [partial])
    expect(host.snapshot).not.toBe(beforeRoom)
    expect(host.snapshot).not.toBe(beforeReplace)
    expect(host.snapshot.pages[0].items[0].erasePoints).toHaveLength(1)
  })

  it('主机授权编辑后 guest 才能改白板;结束会议全员可见', () => {
    const { host, guest } = setup()
    const pageId = guest.snapshot.pages[0].id
    guest.replaceBoardPage(pageId, []) // 未授权:被主机忽略
    expect(host.snapshot.pages[0].items).toHaveLength(0)
    host.setParticipantEdit(GUEST.id, true)
    guest.addBoardItems(pageId, [{ id: 'bi2', type: 'text', pts: [0.1, 0.1], color: '#000', width: 0.03, text: '解:……', by: GUEST.id, at: Date.now() }])
    expect(host.snapshot.pages[0].items.some((i) => i.id === 'bi2')).toBe(true)
    host.endMeeting()
    expect(guest.snapshot.meeting.status).toBe('ended')
  })

  it('举手与屏幕共享帧', () => {
    const { host, guest } = setup()
    guest.raiseHand(true)
    expect(host.snapshot.participants.find((p) => p.userId === GUEST.id)?.handRaised).toBe(true)
    guest.shareFrameToBoard('data:image/jpeg;base64,xxx', 0.5, 0.5)
    const img = host.snapshot.pages[0].items.find((i) => i.type === 'image')
    expect(img?.pts[0]).toBe(0.5)
  })

  it('跨设备接受邀请:用邀请内会议信息在本机重建会议,旧邀请缺失时明确失败', () => {
    const meeting = createMeeting({ title: '跨设备讲题', hostId: HOST.id, hostName: HOST.name, startAt: new Date().toISOString(), plannedMinutes: 30 })
    // 模拟另一台设备:本机没有这场会议的记录
    localStorage.clear()
    expect(getMeeting(meeting.id)).toBeNull()
    const invite = { meetingId: meeting.id, meeting }
    expect(ensureMeetingFromInvite(invite)).toBe(true)
    expect(getMeeting(meeting.id)?.title).toBe('跨设备讲题')
    expect(getMeeting(meeting.id)?.status).toBe('live')
    // 已存在时不重复重建;旧邀请缺失会议信息时明确失败
    expect(ensureMeetingFromInvite(invite)).toBe(true)
    expect(ensureMeetingFromInvite({ meetingId: 'm_missing' })).toBe(false)
  })

  it('擦除走增量通道:主机合并擦除点,授权参会者的增量同步到主机', async () => {
    const { host, guest } = setup()
    const pageId = host.snapshot.pages[0].id
    const stroke = { id: 'stroke-1', type: 'pen' as const, pts: [0.1, 0.1, 0.5, 0.5], color: '#000', width: 3, by: HOST.id, at: Date.now() }
    host.addBoardItems(pageId, [stroke])
    const beforeErase = host.snapshot
    // 主机本地擦除:立即新引用 + 只合并增量点
    host.eraseBoardPoints(pageId, [{ itemId: 'stroke-1', points: [{ x: 0.3, y: 0.3, r: 0.02 }] }])
    expect(host.snapshot).not.toBe(beforeErase)
    expect(host.snapshot.pages[0].items[0].erasePoints).toHaveLength(1)
    // 重复增量去重,不会无限膨胀
    host.eraseBoardPoints(pageId, [{ itemId: 'stroke-1', points: [{ x: 0.3, y: 0.3, r: 0.02 }] }])
    expect(host.snapshot.pages[0].items[0].erasePoints).toHaveLength(1)
    // 授权参会者的擦除增量(100ms 尾随节流后)同步到主机
    host.setParticipantEdit(GUEST.id, true)
    guest.eraseBoardPoints(pageId, [{ itemId: 'stroke-1', points: [{ x: 0.2, y: 0.2, r: 0.02 }] }])
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(host.snapshot.pages[0].items[0].erasePoints).toHaveLength(2)
    // 未授权参会者被拒绝
    host.setParticipantEdit(GUEST.id, false)
    guest.eraseBoardPoints(pageId, [{ itemId: 'stroke-1', points: [{ x: 0.4, y: 0.4, r: 0.02 }] }])
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(host.snapshot.pages[0].items[0].erasePoints).toHaveLength(2)
  }, 10000)
})


// SupabaseRealtimeDriver 的线上消息分发(不触网,直接测 dispatch)
import { SupabaseRealtimeDriver } from '../src/services/rtc'

describe('SupabaseRealtimeDriver 消息分发', () => {
  function makeDriver() {
    const d = new SupabaseRealtimeDriver()
    const seen: { room: unknown[]; chat: unknown[]; board: unknown[]; intents: unknown[] } = { room: [], chat: [], board: [], intents: [] }
    const handlers: RtcHandlers = {
      onRoomState: (st) => seen.room.push(st),
      onChat: (m) => seen.chat.push(m),
      onBoardDelta: (pid, items, rep) => seen.board.push({ pid, items, rep }),
    }
    ;(d as unknown as { handlers: RtcHandlers }).handlers = handlers
    ;(d as unknown as { clientId: string }).clientId = 'me_cli'
    return { d, seen }
  }

  it('room/chat/board 各自路由到对应回调', () => {
    const { d, seen } = makeDriver()
    d.dispatch({ t: 'room', client_id: 'other', state: { meeting: {} as never, participants: [], pages: [], activePageId: '' } })
    d.dispatch({ t: 'chat', client_id: 'other', msg: { id: 'm1', from: 'u', name: 'u', body: 'hi', at: '' } })
    d.dispatch({ t: 'board', client_id: 'other', pageId: 'p1', items: [], replace: true })
    expect(seen.room).toHaveLength(1)
    expect(seen.chat).toHaveLength(1)
    expect(seen.board).toHaveLength(1)
  })

  it('过滤自己的回声(shouldProcess),未知类型忽略', () => {
    const { d, seen } = makeDriver()
    expect(d.shouldProcess({ t: 'room', client_id: 'me_cli' })).toBe(false)
    expect(d.shouldProcess({ t: 'room', client_id: 'other' })).toBe(true)
    expect(d.shouldProcess(undefined)).toBe(false)
    d.dispatch({ t: 'mystery' as never, client_id: 'other' })
    expect(seen.room).toHaveLength(0)
    expect(seen.chat).toHaveLength(0)
  })

  it('intent 交给主机 intentHandler(全局)', () => {
    const { d, seen } = makeDriver()
    const got: unknown[] = []
    setIntentHandler((a) => got.push(a))
    d.dispatch({ t: 'intent', client_id: 'other', action: { kind: 'join', participant: {} } })
    setIntentHandler(null)
    expect(got).toHaveLength(1)
    expect(seen.intents).toHaveLength(0)
  })
})

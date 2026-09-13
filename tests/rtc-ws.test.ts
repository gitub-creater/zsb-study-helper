// 自建 WebSocket 信令驱动测试:消息路由、降级、发送信封(mock WebSocket,不触网)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketRealtimeDriver } from '../src/services/rtc'
import type { RtcHandlers } from '../src/services/rtc'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  url: string

  constructor(url: string | URL) {
    this.url = String(url)
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  // 测试辅助:模拟服务端事件
  serverOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  serverMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ t: 'relay', from: 'peer', payload }) })
  }
}

const handlers: RtcHandlers = {
  onRoomState: vi.fn(),
  onChat: vi.fn(),
  onBoardDelta: vi.fn(),
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WebSocket 信令驱动', () => {
  it('连接成功后发送 hello 信封,消息按类型路由', () => {
    const d = new WebSocketRealtimeDriver('wss://rtc.example.com')
    d.connect('mt_1', handlers)
    const ws = MockWebSocket.instances[0]
    expect(ws.url).toBe('wss://rtc.example.com?room=mt_1')
    ws.serverOpen()
    expect(JSON.parse(ws.sent[0])).toMatchObject({ t: 'hello', room: 'mt_1' })

    d.dispatch({ t: 'chat', client_id: 'peer', msg: { id: 'm1', from: 'u', name: 'u', body: 'hi', at: '' } })
    d.dispatch({ t: 'board', client_id: 'peer', pageId: 'p1', items: [], replace: true })
    d.dispatch({ t: 'board', client_id: 'peer', pageId: 'p1', eraseUpdates: [{ itemId: 'i1', points: [{ x: 0.1, y: 0.1, r: 0.02 }] }] })
    expect(vi.mocked(handlers.onChat).mock.calls[0][0].body).toBe('hi')
    expect(vi.mocked(handlers.onBoardDelta).mock.calls[0]).toEqual(['p1', [], true, undefined])
    expect(vi.mocked(handlers.onBoardDelta).mock.calls[1][3]).toEqual([{ itemId: 'i1', points: [{ x: 0.1, y: 0.1, r: 0.02 }] }])
    d.disconnect()
  })

  it('从未连上时自动降级到 fallback 驱动', () => {
    const fallback = { connect: vi.fn(), disconnect: vi.fn(), send: vi.fn() }
    const d = new WebSocketRealtimeDriver('wss://rtc.example.com', fallback)
    d.connect('mt_2', handlers)
    const ws = MockWebSocket.instances[0]
    ws.onclose?.() // 未 open 就断开:降级
    expect(fallback.connect).toHaveBeenCalledWith('mt_2', handlers)
  })

  it('open 后发送走 relay 信封;重连中断时发送被丢弃不报错', () => {
    const d = new WebSocketRealtimeDriver('wss://rtc.example.com')
    d.connect('mt_3', handlers)
    const ws = MockWebSocket.instances[0]
    // 未 open 时发送:静默丢弃
    d.send({ kind: 'chat', msg: { id: 'x', from: 'u', name: 'u', body: 'drop', at: '' } })
    expect(ws.sent).toHaveLength(0)
    ws.serverOpen()
    d.send({ kind: 'chat', msg: { id: 'm2', from: 'u', name: 'u', body: 'hi', at: '' } })
    const relay = JSON.parse(ws.sent[1])
    expect(relay.t).toBe('relay')
    expect(relay.payload).toMatchObject({ t: 'chat', msg: { body: 'hi' } })
    expect(d.channelState).toBe('open')
    d.disconnect()
    expect(d.channelState).toBe('closed')
  })

  it('驱动工厂无注入时正常返回驱动(防 main.tsx 自引用递归复发)', async () => {
    const { createDefaultDriver } = await import('../src/services/rtc')
    const d = createDefaultDriver()
    expect(d).toBeTruthy()
    expect(typeof d.connect).toBe('function')
    d.disconnect()
  })
})

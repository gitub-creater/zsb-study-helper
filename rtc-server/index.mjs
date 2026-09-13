// 专升本学习助手 · 会议 WebSocket 信令服务器
//
// 职责:按房间转发客户端消息(room/chat/board/intent wire),不做业务裁决(主机权威模型在客户端)。
// 设计要点:
// - 纯内存房间表,服务重启后客户端自动重连并从主机重新拉取房间快照,无需持久化
// - 同一 clientId 重连(页面刷新)时挤占旧连接,防止双开互踢
// - 30s 协议层心跳,死连接及时清理
// - 部署:任意 Node 18+ 宿主(Render/Railway/学生机),PORT 环境变量可覆盖端口
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8787)
// eslint-disable-next-line no-new
const wss = new WebSocketServer({ port: PORT })

/** roomId -> Map<clientId, WebSocket> */
const rooms = new Map()

function safeSend(ws, data) {
  if (ws.readyState === 1 /* OPEN */) ws.send(data)
}

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.room = null
  ws.clientId = null
  ws.on('pong', () => {
    ws.isAlive = true
  })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.t === 'hello') {
      if (typeof msg.room !== 'string' || typeof msg.clientId !== 'string' || !msg.room || !msg.clientId) return
      const room = rooms.get(msg.room) ?? new Map()
      const old = room.get(msg.clientId)
      if (old && old !== ws) {
        try {
          old.close(4000, 'replaced')
        } catch {
          /* ignore */
        }
      }
      room.set(msg.clientId, ws)
      rooms.set(msg.room, room)
      ws.room = msg.room
      ws.clientId = msg.clientId
      safeSend(ws, JSON.stringify({ t: 'hello-ok', clients: room.size }))
      return
    }
    if (msg.t !== 'relay' || !ws.room || !ws.clientId) return
    const room = rooms.get(ws.room)
    if (!room) return
    const data = JSON.stringify({ t: 'relay', from: ws.clientId, payload: msg.payload })
    for (const [id, entry] of room) {
      if (id !== ws.clientId) safeSend(entry, data)
    }
  })

  ws.on('close', () => {
    const room = rooms.get(ws.room)
    if (room && ws.clientId) {
      room.delete(ws.clientId)
      if (room.size === 0) rooms.delete(ws.room)
    }
  })

  ws.on('error', () => {
    try {
      ws.terminate()
    } catch {
      /* ignore */
    }
  })
})

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    for (const entry of room.values()) {
      if (!entry.isAlive) {
        try {
          entry.terminate()
        } catch {
          /* ignore */
        }
        continue
      }
      entry.isAlive = false
      entry.ping()
    }
  }
}, 30000)

wss.on('close', () => clearInterval(heartbeat))

console.log(`[rtc-server] websocket signaling listening on :${PORT}`)

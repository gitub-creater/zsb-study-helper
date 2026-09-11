// 在线讲题会议(钉钉式):列表(邀请/创建) + 房间(工具栏/参会宫格/聊天/白板)
// 与问题社区联通:会议可关联问题,房间内显示原题并一键贴到白板讲题
// 音视频:当前用本地摄像头/麦克风状态与屏幕抓帧;跨设备音视频由 RtcDriver 接口接入(见 services/rtc.ts)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { Modal, Field, useToast, useConfirm, EmptyState } from '../components/ui'
import { Whiteboard, renderPageToCanvas, pageBounds } from '../components/Whiteboard'
import { FeatureTour, filterExistingSteps } from '../components/FeatureTour'
import type { TourStep } from '../components/FeatureTour'
import { MeetingSession, createMeeting, getMeeting, listMeetings, upsertMeeting } from '../services/rtc'
import { createInvite, getUserGroups, groupMessages, loadCommunity, respondInvite, subscribeCommunity } from '../services/community'
import { cloudSendInvite } from '../services/communityCloud'
import { exportCanvasesToPdf } from '../lib/pdf'
import { downloadBlob, uid } from '../lib/misc'
import { AVATAR_INFO } from '../lib/theme'
import type { BoardItem, BoardPage, CommunityPost, MeetingChatMsg, MeetingInfo, MeetingInvite, MeetingRoomState } from '../types'

export interface MeInfo {
  id: string
  name: string
}

function parseHash(): { roomId: string | null; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#\//, '')
  const [pathPart, queryPart] = raw.split('?')
  const sub = pathPart.split('/')[1] ?? ''
  return { roomId: sub || null, query: new URLSearchParams(queryPart ?? '') }
}

export function MeetingPage({ me }: { me: MeInfo }) {
  const { roomId, query } = parseHash()
  if (roomId) {
    if (!getMeeting(roomId) && query.get('title')) {
      upsertMeeting({ id: roomId, title: query.get('title') || '答疑会议', hostId: query.get('host') || 'shared-host', hostName: query.get('hostName') || '主讲人', postId: query.get('post') || undefined, startAt: query.get('start') || new Date().toISOString(), plannedMinutes: Math.max(5, Number(query.get('mins')) || 60), status: 'scheduled', createdAt: new Date().toISOString() })
    }
    return <MeetingRoom meetingId={roomId} me={me} />
  }
  return <MeetingList me={me} />
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtClock(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- 列表 ----------

function MeetingList({ me }: { me: MeInfo }) {
  const toast = useToast()
  const [tick, setTick] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const { query } = parseHash()
  const prefill = { postId: query.get('post') ?? '', to: query.get('to') ?? '', name: query.get('name') ?? '' }

  useEffect(() => subscribeCommunity(() => setTick((t) => t + 1)), [])
  const data = useMemo(() => loadCommunity(), [tick])
  const meetings = listMeetings()
  const postTitle = (postId?: string) => (postId ? data.posts.find((p) => p.id === postId)?.title : undefined)
  const myInvites = data.invites.filter((i) => i.to === me.id && i.status === 'pending')

  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setTourOpen(true), 400)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="page meet-list">
      {tourOpen && <FeatureTour steps={filterExistingSteps(MEETING_LIST_TOUR)} onClose={() => setTourOpen(false)} />}
      <section className="card">
        <div className="card-h">
          <b>会议邀请</b>
        </div>
        {myInvites.length === 0 ? (
          <p className="muted">暂无待处理的邀请。别人在问题详情页发起讲题会议并邀请你后,这里会出现通知。</p>
        ) : (
          <ul className="meet-invites" data-tour="invites">
            {myInvites.map((i) => (
              <li key={i.id}>
                <Icon name="video" size={16} />
                <span className="meet-invite-main">
                  <b>{i.meetingTitle}</b>
                  <span className="muted">{i.from.name} 邀请你参加 · {fmtTime(i.at)}</span>
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    respondInvite(i.id, true)
                    window.location.hash = `#/meeting/${i.meetingId}`
                  }}
                >
                  接受进入
                </button>
                <button className="btn btn-sm" onClick={() => respondInvite(i.id, false)}>
                  拒绝
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-h">
          <b>讲题会议</b>
          <button className="btn btn-sm btn-primary" data-tour="create" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> 发起会议
          </button>
        </div>
        {meetings.length === 0 ? (
          <EmptyState mood="think" title="还没有会议" desc="到「问题社区」打开一个问题时点「发起讲题会议」,题目会自动带进白板;也可以直接在这里创建。" />
        ) : (
          <ul className="meet-items">
            {meetings.map((m) => {
              const qTitle = postTitle(m.postId)
              return (
                <li key={m.id}>
                  <span className={`chip chip-${m.status === 'live' ? 'green' : m.status === 'ended' ? 'gray' : 'blue'}`}>
                    {m.status === 'live' ? '进行中' : m.status === 'ended' ? '已结束' : '未开始'}
                  </span>
                  <span className="meet-item-main">
                    <b>{m.title}</b>
                    <span className="muted">
                      主讲:{m.hostName} · {fmtTime(m.startAt)} · 预计 {m.plannedMinutes} 分钟
                    </span>
                    {qTitle && (
                      <a className="meet-q-link" href={`#/community/${m.postId}`}>
                        <Icon name="chat" size={12} /> 关联问题:{qTitle}
                      </a>
                    )}
                  </span>
                  {m.status !== 'ended' ? (
                    <a className="btn btn-sm btn-primary" href={`#/meeting/${m.id}`}>
                      <Icon name="video" size={14} /> 进入
                    </a>
                  ) : (
                    <span className="muted">{m.endedAt ? `结束于 ${fmtTime(m.endedAt)}` : ''}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          提示:同一设备用两个浏览器标签页打开同一会议,即可体验主讲人与参会者的实时白板/聊天/举手;跨设备音视频需接入实时服务(接口已就绪)。
        </p>
      </section>

      <CreateMeetingModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        me={me}
        prefill={prefill}
        onCreated={(m) => {
          window.location.hash = `#/meeting/${m.id}`
        }}
        toast={toast}
      />
    </div>
  )
}

function CreateMeetingModal({
  open,
  onClose,
  me,
  prefill,
  onCreated,
  toast,
}: {
  open: boolean
  onClose: () => void
  me: MeInfo
  prefill: { postId: string; to: string; name: string }
  onCreated: (m: MeetingInfo) => void
  toast: (msg: string, opts?: { kind?: 'info' | 'success' | 'error' }) => void
}) {
  const [title, setTitle] = useState('')
  const [startAt, setStartAt] = useState(() => new Date(Date.now() + 10 * 60000).toISOString().slice(0, 16))
  const [minutes, setMinutes] = useState(30)
  const [invite, setInvite] = useState(prefill.to ? true : false)

  useEffect(() => {
    if (open) setInvite(!!prefill.to)
  }, [open, prefill.to])

  return (
    <Modal
      open={open}
      title="发起会议"
      onClose={onClose}
      width={430}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!title.trim()) {
                toast('请填写会议标题', { kind: 'error' })
                return
              }
              if (!startAt) {
                toast('请选择开始时间', { kind: 'error' })
                return
              }
              const m = createMeeting({
                title,
                hostId: me.id,
                hostName: me.name,
                startAt: new Date(startAt).toISOString(),
                plannedMinutes: minutes,
                postId: prefill.postId || undefined,
              })
              if (invite && prefill.to) {
                const inviteRecord = createInvite({ meetingId: m.id, meetingTitle: m.title, from: { id: me.id, name: me.name, avatar: 'sprout' }, to: prefill.to })
                cloudSendInvite(inviteRecord, prefill.to)
                toast('已创建会议并发送站内邀请', { kind: 'success' })
              } else {
                toast('会议已创建', { kind: 'success' })
              }
              onCreated(m)
            }}
          >
            创建{invite && prefill.to ? '并邀请' : ''}
          </button>
        </>
      }
    >
      <Field label="会议标题">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如:高数第三章答疑" maxLength={40} />
      </Field>
      <Field label="开始时间">
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </Field>
      <Field label={`预计时长 ${minutes} 分钟`}>
        <input type="range" min={10} max={120} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="预计时长" />
      </Field>
      {prefill.to ? (
        <label className="check-row">
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
          向提问人「{prefill.name || prefill.to}」发送站内邀请
        </label>
      ) : null}
    </Modal>
  )
}

function InviteFriendsGroupsButton({
  meeting,
  me,
  participants,
  toast,
}: {
  meeting: MeetingInfo
  me: MeInfo
  participants: MeetingRoomState['participants']
  toast: (msg: string, opts?: { kind?: 'info' | 'success' | 'error' }) => void
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}><Icon name="users" size={13} /> 邀请好友/群组</button>
    {open && <InviteFriendsGroupsModal meeting={meeting} me={me} participants={participants} toast={toast} onClose={() => setOpen(false)} onCopied={() => {
      const base = `${location.origin}${location.pathname}${location.search}`.split('#')[0]
      const params = new URLSearchParams({ title: meeting.title, host: meeting.hostId, hostName: meeting.hostName, start: meeting.startAt, mins: String(meeting.plannedMinutes) })
      if (meeting.postId) params.set('post', meeting.postId)
      const link = `${base}#/meeting/${encodeURIComponent(meeting.id)}?${params.toString()}`
      navigator.clipboard?.writeText(link).then(() => toast('会议链接已复制', { kind: 'success' }))
    }} />}
  </>
}

function InviteFriendsGroupsModal({
  meeting, me, participants, toast, onClose, onCopied,
}: {
  meeting: MeetingInfo
  me: MeInfo
  participants: MeetingRoomState['participants']
  toast: (msg: string, opts?: { kind?: 'info' | 'success' | 'error' }) => void
  onClose: () => void
  onCopied: () => void
}) {
  const data = loadCommunity()
  const joined = new Set(participants.map((participant) => participant.userId))
  const friends = data.friends.flatMap((edge) => {
    const otherId = edge.a === me.id ? edge.b : edge.b === me.id ? edge.a : ''
    if (!otherId || joined.has(otherId)) return []
    const user = edge.a === otherId ? edge.aUser : edge.bUser
    return user && user.id !== me.id ? [user] : []
  })
  const groups = getUserGroups(data, me.id)
  const [tab, setTab] = useState<'friends' | 'groups'>('friends')
  const [selectedFriends, setSelectedFriends] = useState<string[]>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const send = () => {
    const recipients = new Set(selectedFriends)
    for (const groupId of selectedGroups) {
      const group = groups.find((item) => item.id === groupId)
      group?.memberIds.forEach((id) => { if (id !== me.id && !joined.has(id)) recipients.add(id) })
    }
    if (recipients.size === 0) { toast('请选择好友或群组', { kind: 'error' }); return }
    for (const to of recipients) {
      const from = { id: me.id, name: me.name, avatar: 'sprout' as const }
      const invite = createInvite({ meetingId: meeting.id, meetingTitle: meeting.title, from, to })
      cloudSendInvite({ ...invite, at: new Date().toISOString(), status: 'pending' }, to)
    }
    toast(`已向 ${recipients.size} 位成员发送会议邀请`, { kind: 'success' })
    onClose()
  }
  return <Modal open title="邀请好友/群组进入会议" onClose={onClose} width={460} footer={<><button className="btn" onClick={onClose}>取消</button><button className="btn" onClick={onCopied}>复制会议链接</button><button className="btn btn-primary" onClick={send}>发送邀请</button></>}>
    <div className="seg" role="tablist"><button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>好友 ({friends.length})</button><button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>群组 ({groups.length})</button></div>
    <div className="invite-select-list">
      {tab === 'friends' ? (friends.length ? friends.map((friend) => <label className="check-row" key={friend.id}><input type="checkbox" checked={selectedFriends.includes(friend.id)} onChange={(event) => setSelectedFriends((ids) => event.target.checked ? [...ids, friend.id] : ids.filter((id) => id !== friend.id))} /><Avatar kind={friend.avatar} color={AVATAR_INFO[friend.avatar].color} size={26} />{friend.name}</label>) : <p className="muted">暂无可邀请好友，请先在问题社区添加好友。</p>) : (groups.length ? groups.map((group) => <label className="check-row" key={group.id}><input type="checkbox" checked={selectedGroups.includes(group.id)} onChange={(event) => setSelectedGroups((ids) => event.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id))} /><span><b>{group.name}</b><small className="muted">{group.memberIds.filter((id) => id !== me.id && !joined.has(id)).length} 位成员可邀请</small></span></label>) : <p className="muted">暂无群组，请先创建学习群组。</p>)}
    </div>
  </Modal>
}

// ---------- 房间 ----------

function MeetingRoom({ meetingId, me }: { meetingId: string; me: MeInfo }) {
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const meeting = getMeeting(meetingId)
  const isHost = meeting?.hostId === me.id

  if (!meeting) {
    return (
      <div className="page">
        <EmptyState mood="think" title="会议不存在" desc="链接可能已失效" action={<a className="btn btn-primary" href="#/meeting">返回会议列表</a>} />
      </div>
    )
  }

  return <RoomInner key={meetingId} meeting={meeting} me={me} isHost={!!isHost} confirmNode={confirmNode} confirm={confirm} toast={toast} />
}

const QUICK_PHRASES = ['听不懂 😵', '再讲一遍 🙏', '懂了 👍', '这一步为什么?', '谢谢!']

function RoomInner({
  meeting,
  me,
  isHost,
  confirmNode,
  confirm,
  toast,
}: {
  meeting: MeetingInfo
  me: MeInfo
  isHost: boolean
  confirmNode: React.ReactNode
  confirm: (o: { title: string; desc?: string; danger?: boolean; confirmText?: string }) => Promise<boolean>
  toast: (msg: string, opts?: { kind?: 'info' | 'success' | 'error' }) => void
}) {
  const sessionRef = useRef<MeetingSession | null>(null)
  const [room, setRoom] = useState<MeetingRoomState | null>(null)
  const [chat, setChat] = useState<MeetingChatMsg[]>([])
  const [chatText, setChatText] = useState('')
  const [micOn, setMicOn] = useState(isHost)
  const [camOn, setCamOn] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 关联的社区问题(讲题联动)
  const [linkedPost, setLinkedPost] = useState<CommunityPost | null>(null)
  useEffect(() => {
    if (!meeting.postId) return
    const pull = () => setLinkedPost(loadCommunity().posts.find((p) => p.id === meeting.postId) ?? null)
    pull()
    return subscribeCommunity(pull)
  }, [meeting.postId])

  useEffect(() => {
    const s = new MeetingSession({ meeting, me, isHost })
    sessionRef.current = s
    s.start()
    setRoom(s.snapshot)
    const un = s.subscribe(setRoom)
    const unChat = s.subscribeChat(setChat)
    return () => {
      un()
      unChat()
      s.stop()
      sessionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id])

  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed(Math.max(0, Date.now() - new Date(meeting.startAt).getTime()))
    }, 1000)
    return () => window.clearInterval(t)
  }, [meeting.startAt])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.length])

  // 摄像头本地预览(进宫格)
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (camOn) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480 }, audio: false })
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop())
            return
          }
          streamRef.current = stream
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            await videoRef.current.play().catch(() => {})
          }
        } catch {
          toast('摄像头打开失败:请检查浏览器权限', { kind: 'error' })
          setCamOn(false)
        }
      } else {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [camOn, toast])

  // 麦克风实时音量(钉钉式绿条)
  useEffect(() => {
    if (!micOn) {
      setMicLevel(0)
      return
    }
    let stopped = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(s)
        const an = ctx.createAnalyser()
        an.fftSize = 256
        src.connect(an)
        const buf = new Uint8Array(an.frequencyBinCount)
        const tick = () => {
          an.getByteFrequencyData(buf)
          const avg = buf.reduce((a, b) => a + b, 0) / buf.length
          setMicLevel(Math.min(100, Math.round(avg * 1.8)))
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => {
        toast('麦克风打开失败:请检查浏览器权限(不影响白板讲题)', { kind: 'error' })
        setMicOn(false)
      })
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
    }
  }, [micOn, toast])

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    []
  )

  // 每次进入会议都显示引导(可跳过;新手跟着箭头一步步点)。hooks 必须在条件返回之前
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setTourOpen(true), 700)
    return () => window.clearTimeout(t)
  }, [])

  if (!room) return null
  const meP = room.participants.find((p) => p.userId === me.id)
  const canEditBoard = sessionRef.current?.canEditBoard(me.id) ?? isHost
  const activePage = room.pages.find((p) => p.id === room.activePageId) ?? room.pages[0]
  const ended = room.meeting.status === 'ended'
  const remainingMin = Math.max(0, meeting.plannedMinutes - Math.floor(elapsed / 60000))

  async function endMeeting() {
    const ok = await confirm({ title: '结束会议', desc: '确定结束当前会议吗?所有参会者将被断开。', danger: true, confirmText: '结束会议' })
    if (!ok) return
    sessionRef.current?.endMeeting()
    toast('会议已结束', { kind: 'success' })
  }

  function copyLink() {
    const link = meetingLink()
    navigator.clipboard?.writeText(link).then(
      () => toast('会议链接已复制,发给对方即可加入', { kind: 'success' }),
      () => toast(`复制失败,请手动复制:${link}`, { kind: 'error' })
    )
  }

  function meetingLink(): string {
    const m = room!.meeting
    const base = `${location.origin}${location.pathname}${location.search}`.split('#')[0]
    const params = new URLSearchParams({ title: m.title, host: m.hostId, hostName: m.hostName, start: m.startAt, mins: String(m.plannedMinutes) })
    if (m.postId) params.set('post', m.postId)
    return `${base}#/meeting/${encodeURIComponent(m.id)}?${params.toString()}`
  }

  function shareLink() {
    const link = meetingLink()
    if (navigator.share) void navigator.share({ title: room!.meeting.title, text: '加入在线讲题会议', url: link }).catch(() => {})
    else copyLink()
  }

  function exportPng() {
    void renderPageToCanvas(activePage).then((canvas) =>
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(`白板-第${room!.pages.indexOf(activePage) + 1}页.png`, blob)
      }, 'image/png')
    )
  }

  async function exportPdf() {
    const canvases = await Promise.all(room!.pages.map((p) => renderPageToCanvas(p)))
    exportCanvasesToPdf(canvases, `${room!.meeting.title}-白板.pdf`)
    toast('PDF 已导出', { kind: 'success' })
  }

  /** 无限画布上的空位:贴到现有内容右侧 */
  function nextSlot(page: BoardPage): { wx: number; wy: number } {
    const b = pageBounds(page)
    return { wx: b.x1 + 0.04, wy: b.y0 }
  }

  /** 钉钉式"共享屏幕":抓一帧直接贴到白板讲题 */
  async function shareScreenToBoard() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
      const v = document.createElement('video')
      v.srcObject = s
      v.muted = true
      await v.play().catch(() => {})
      await new Promise((r) => setTimeout(r, 350))
      const vw = v.videoWidth || 1280
      const vh = v.videoHeight || 720
      const c = document.createElement('canvas')
      c.width = Math.min(1920, vw)
      c.height = Math.round((c.width * vh) / vw)
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      const url = c.toDataURL('image/jpeg', 0.85)
      s.getTracks().forEach((t) => t.stop())
      const { wx, wy } = nextSlot(activePage)
      sessionRef.current?.shareFrameToBoard(url, wx, wy)
      toast('屏幕已截图贴到白板,直接在上面圈画讲题', { kind: 'success' })
    } catch {
      toast('已取消共享(或浏览器不支持屏幕捕获)', { kind: 'info' })
    }
  }

  /** 原题(文字+图片)贴到白板 */
  function putQuestionOnBoard() {
    if (!linkedPost) return
    const { wx, wy } = nextSlot(activePage)
    const items: BoardItem[] = [
      {
        id: uid('bi'),
        type: 'text',
        pts: [wx, wy],
        color: '#26313e',
        width: 0.03,
        text: `【题目】${linkedPost.title}\n${linkedPost.body}`,
        by: me.id,
        at: Date.now(),
      },
    ]
    linkedPost.images.slice(0, 2).forEach((src, i) => {
      items.push({ id: uid('bi'), type: 'image', pts: [wx, wy + 0.42 + i * 0.42, wx + 0.4, wy + 0.42 * 1.3 + i * 0.42], color: '#000', width: 0, src, by: me.id, at: Date.now() })
    })
    sessionRef.current?.addBoardItems(activePage.id, items)
    toast('题目已贴到白板,开讲!', { kind: 'success' })
  }

  const mins = Math.floor(elapsed / 60000)
  const secs = Math.floor((elapsed % 60000) / 1000)

  return (
    <div className="page meet-room">
      {confirmNode}
      {tourOpen && <FeatureTour steps={filterExistingSteps(MEETING_ROOM_TOUR)} onClose={() => setTourOpen(false)} />}
      <div className="meet-head card">
        <div className="meet-head-main">
          <b>{room.meeting.title}</b>
          <span className={`chip chip-${ended ? 'gray' : 'green'}`}>{ended ? '已结束' : '进行中'}</span>
          <span className="chip num">
            <Icon name="clock" size={12} /> {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')} / 剩 {remainingMin} 分
          </span>
          <span className="muted">
            主讲:{room.meeting.hostName} · {room.participants.length} 人在会
          </span>
        </div>
        <div className="meet-head-ops">
          {isHost && <InviteFriendsGroupsButton meeting={room.meeting} me={me} participants={room.participants} toast={toast} />}
          <button className="btn btn-sm" onClick={copyLink}>
            <Icon name="copy" size={13} /> 复制会议链接
          </button>
          <button className="btn btn-sm" onClick={shareLink}><Icon name="upload" size={13} /> 分享给同学</button>
          <a className="btn btn-sm" href={meetingLink()}><Icon name="video" size={13} /> 打开链接</a>
        </div>
      </div>

      {/* 钉钉式底部/顶部工具栏:大圆钮 */}
      <div className="meet-toolbar" role="toolbar" aria-label="会议控制" data-tour="toolbar">
        <button
          className={`meet-rbtn${micOn ? ' on' : ''}`}
          disabled={ended || (!isHost && meP ? !meP.canSpeak : false)}
          title={!isHost && !meP?.canSpeak ? '主讲人未允许你发言' : '麦克风'}
          onClick={() => {
            const next = !micOn
            setMicOn(next)
            sessionRef.current?.toggleMyMic(next)
          }}
        >
          <Icon name="mic" size={19} />
          <span>{micOn ? '静音' : '解除静音'}</span>
          {micOn && <i className="meet-level" style={{ width: `${micLevel}%` }} aria-hidden />}
        </button>
        <button className={`meet-rbtn${camOn ? ' on' : ''}`} disabled={ended} onClick={() => setCamOn((v) => !v)}>
          <Icon name="video" size={19} />
          <span>{camOn ? '关摄像头' : '开摄像头'}</span>
        </button>
        <button className="meet-rbtn meet-rbtn-share" disabled={ended} onClick={() => void shareScreenToBoard()} title="截取屏幕一帧贴到白板,在上面圈画讲题">
          <Icon name="upload" size={19} />
          <span>共享到白板</span>
        </button>
        <button className={`meet-rbtn${meP?.handRaised ? ' on' : ''}`} disabled={ended} onClick={() => sessionRef.current?.raiseHand(!meP?.handRaised)}>
          <span className="meet-hand" aria-hidden>✋</span>
          <span>{meP?.handRaised ? '放下手' : '举手'}</span>
        </button>
        {isHost ? (
          <>
            <button className="meet-rbtn" disabled={ended} onClick={() => sessionRef.current?.muteAll()} title="把所有参会者静音">
              <Icon name="volume" size={19} />
              <span>全体静音</span>
            </button>
            <button className="meet-rbtn meet-rbtn-danger" disabled={ended} onClick={() => void endMeeting()}>
              <Icon name="stop" size={19} />
              <span>结束会议</span>
            </button>
          </>
        ) : (
          <a className="meet-rbtn meet-rbtn-danger" href="#/meeting">
            <Icon name="left" size={19} />
            <span>离开会议</span>
          </a>
        )}
      </div>

      <p className="page-hint">
        💡 讲题三步:点<b>「题目贴到白板」</b>放上原题 → 用<b>画笔/图形</b>边画边讲 →
        <b>「共享到白板」</b>把屏幕截图贴上来圈重点;✋举手示意,主讲人可授权发言与编辑。
      </p>

      {/* 参会者宫格(钉钉式) */}
      <div className="meet-gallery" aria-label="参会者视频宫格" data-tour="gallery">
        {room.participants.map((p) => (
          <div key={p.userId} className={`meet-tile${p.handRaised ? ' hand' : ''}${p.camOn && p.userId === me.id ? ' cam' : ''}`}>
            {p.userId === me.id && camOn ? (
              <video ref={videoRef} muted playsInline aria-label="我的摄像头预览" />
            ) : (
              <Avatar kind="sprout" color={AVATAR_INFO.sprout.color} size={40} />
            )}
            <span className="meet-tile-name">
              {p.role === 'host' && <b className="meet-crown">主讲</b>}
              {p.name}
            </span>
            <span className="meet-tile-badges">
              {!p.micOn && <Icon name="mic" size={12} className="meet-off" />}
              {p.handRaised && <span aria-label="已举手">✋</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="meet-grid">
        <div className="meet-board-col card">
          {/* 讲题联动:原题卡片 */}
          {linkedPost && (
            <details className="meet-question" open data-tour="question">
              <summary>
                <Icon name="chat" size={14} /> 待讲题目:{linkedPost.title}
              </summary>
              <div className="meet-question-body">
                <p>{linkedPost.body}</p>
                {linkedPost.images.length > 0 && (
                  <div className="post-imgs">
                    {linkedPost.images.map((src, i) => (
                      <img key={i} src={src} alt={`题目图片 ${i + 1}`} />
                    ))}
                  </div>
                )}
                <div className="meet-question-ops">
                  <a className="btn btn-xs" href={`#/community/${linkedPost.id}`}>
                    查看问题详情
                  </a>
                  {canEditBoard && !ended && (
                    <button className="btn btn-xs btn-primary" onClick={putQuestionOnBoard}>
                      <Icon name="edit" size={12} /> 题目贴到白板
                    </button>
                  )}
                </div>
              </div>
            </details>
          )}
          <div className="card-h">
            <b>讲题白板</b>
            <span className="meet-page-tabs" data-tour="pages">
              {room.pages.map((p, i) => (
                <button
                  key={p.id}
                  className={`chip chip-${p.id === activePage.id ? 'blue' : 'gray'}`}
                  onClick={() => sessionRef.current?.setActivePage(p.id)}
                  aria-label={`切换到第 ${i + 1} 页`}
                >
                  第{i + 1}页
                </button>
              ))}
              {canEditBoard && !ended && (
                <>
                  <button className="btn btn-icon" title="新增一页" aria-label="新增一页" onClick={() => sessionRef.current?.addPage()}>
                    <Icon name="plus" size={14} />
                  </button>
                  {room.pages.length > 1 && (
                    <button className="btn btn-icon" title="删除本页" aria-label="删除本页" onClick={() => void sessionRef.current?.removePage(activePage.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </>
              )}
            </span>
            <span className="meet-board-ops">
              <button className="btn btn-sm" onClick={() => sessionRef.current?.saveNow()}>
                保存白板
              </button>
              <button className="btn btn-sm" onClick={exportPng}>
                导出 PNG
              </button>
              <button className="btn btn-sm" onClick={() => void exportPdf()}>
                导出 PDF
              </button>
            </span>
          </div>
          <Whiteboard
            page={activePage}
            canEdit={canEditBoard && !ended}
            onAddItems={(items) => sessionRef.current?.addBoardItems(activePage.id, items)}
            onReplaceItems={(items) => sessionRef.current?.replaceBoardPage(activePage.id, items)}
            onSetBg={(dataUrl) => sessionRef.current?.setPageBg(activePage.id, dataUrl)}
            onSetGrid={(grid) => sessionRef.current?.setPageGrid(activePage.id, grid)}
          />
        </div>

        <aside className="meet-side">
          <section className="card" data-tour="parts">
            <div className="card-h">
              <b>参会人员({room.participants.length})</b>
            </div>
            <ul className="meet-parts">
              {room.participants.map((p) => (
                <li key={p.userId}>
                  <span className="meet-part-name">
                    <b>{p.name}</b>
                    {p.role === 'host' && <span className="chip chip-yellow">主讲</span>}
                    {!p.canSpeak && p.role !== 'host' && <span className="chip chip-gray">禁言</span>}
                    {p.handRaised && <span className="chip chip-red">✋ 举手</span>}
                  </span>
                  <span className="meet-part-state">
                    <Icon name="mic" size={14} className={p.micOn ? 'meet-on' : 'meet-off'} />
                    {p.camOn && <Icon name="video" size={14} className="meet-on" />}
                  </span>
                  {isHost && p.role !== 'host' && !ended && (
                    <span className="meet-part-ops">
                      <button className="btn btn-xs" onClick={() => sessionRef.current?.setParticipantMic(p.userId, !p.micOn)}>
                        {p.micOn ? '静音' : '解除静音'}
                      </button>
                      <button className="btn btn-xs" onClick={() => sessionRef.current?.setParticipantSpeak(p.userId, !p.canSpeak)}>
                        {p.canSpeak ? '禁止发言' : '允许发言'}
                      </button>
                      <button
                        className="btn btn-xs"
                        onClick={() => sessionRef.current?.setParticipantEdit(p.userId, !(room.editorsAccess ?? []).includes(p.userId))}
                      >
                        {(room.editorsAccess ?? []).includes(p.userId) ? '收回编辑' : '允许编辑'}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card meet-chat-card" data-tour="chat">
            <div className="card-h">
              <b>聊天区</b>
            </div>
            <div className="meet-chat" aria-live="polite">
              {chat.length === 0 && <p className="muted">还没有消息,说点什么吧~</p>}
              {chat.map((m) => (
                <div key={m.id} className={`meet-msg${m.from === '__sys' ? ' sys' : m.from === me.id ? ' mine' : ''}`}>
                  {m.from !== '__sys' && (
                    <b>
                      {m.from === me.id ? '我' : m.name} <time>{fmtClock(m.at)}</time>
                    </b>
                  )}
                  <span>{m.body}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="meet-quick" data-tour="quick">
              {QUICK_PHRASES.map((q) => (
                <button key={q} className="chip chip-gray" onClick={() => sessionRef.current?.sendChat(q)} disabled={ended}>
                  {q}
                </button>
              ))}
            </div>
            <form
              className="meet-chat-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!chatText.trim()) return
                sessionRef.current?.sendChat(chatText)
                setChatText('')
              }}
            >
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="输入问题或发言…" maxLength={300} aria-label="聊天输入" />
              <button className="btn btn-icon btn-primary" type="submit" aria-label="发送">
                <Icon name="send" size={15} />
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** 从问题详情页快捷发起:创建会议 + 邀请提问人 + 跳转 */
export function startMeetingForPost(me: MeInfo, postId: string, invitee: { id: string; name: string }): MeetingInfo {
  const m = createMeeting({
    title: '讲题会议',
    hostId: me.id,
    hostName: me.name,
    startAt: new Date().toISOString(),
    plannedMinutes: 30,
    postId,
  })
  const invite: MeetingInvite = { id: uid('inv'), meetingId: m.id, meetingTitle: m.title, from: { id: me.id, name: me.name, avatar: 'sprout' }, to: invitee.id, at: new Date().toISOString(), status: 'pending' }
  createInvite(invite)
  cloudSendInvite(invite, invitee.id)
  upsertMeeting(m)
  return m
}

const MEETING_LIST_TOUR: TourStep[] = [
  { sel: '[data-tour="invites"]', title: '会议邀请', text: '别人在问题页发起讲题会议并邀请你时,这里会出现通知,点「接受进入」直达白板。', prefer: 'bottom' },
  { sel: '[data-tour="create"]', title: '发起会议', text: '也可以直接创建会议;更推荐从「问题社区」的问题详情页发起,原题会自动带进白板。', prefer: 'bottom' },
  { sel: '[data-tour="create"]', title: '双端同步', text: '同一设备开两个标签页、或手机与电脑各自进入同一会议,白板和聊天实时互通。', prefer: 'bottom' },
]

const MEETING_ROOM_TOUR: TourStep[] = [
  { sel: '[data-tour="toolbar"]', title: '会议控制台', text: '麦克风(带音量条)/摄像头;「共享到白板」把屏幕截图贴上白板圈画讲题;✋举手示意;主讲人可全体静音、结束会议。', prefer: 'bottom' },
  { sel: '[data-tour="gallery"]', title: '参会者宫格', text: '谁在会、麦克风开关、谁在举手,一眼可见。', prefer: 'bottom' },
  { sel: '[data-tour="question"]', title: '待讲题目', text: '从社区带来的原题在这里;点「题目贴到白板」把题目和图片放上画布。', prefer: 'right' },
  { sel: '[data-tour="pages"]', title: '多页白板', text: '可新增/切换多页;支持保存、导出 PNG 和 PDF。', prefer: 'bottom' },
  { sel: '.wb-toolbar', title: '希沃式白板工具', text: '画笔/荧光笔/橡皮/图形/文字;「手型」按住拖动=无限画布;方格纸/横线底纹;双击文字可改;全屏讲课。', prefer: 'bottom' },
  { sel: '[data-tour="parts"]', title: '参会管理(主讲人)', text: '对单个参会者:静音/解除静音、允许发言、允许编辑白板;普通参会者默认只读。', prefer: 'left' },
  { sel: '[data-tour="quick"]', title: '聊天与快捷短语', text: '「听不懂/再讲一遍/懂了」一键发送;输入框实时聊天。', prefer: 'top' },
]

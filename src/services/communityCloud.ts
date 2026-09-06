// 社区云端事件层:好友请求 / 站内会议邀请 / 私信 的跨设备同步
// 统一走 rtc_message 表(room_id='community',anon 可写已配策略),接收端订阅 postgres_changes 合并进本地共享数据。
// 身份:本应用自有账号体系(payload 里带 CommunityUser),sender_uid 保持 null(auth.users 外键)。
import { getSupabase, supabaseConfigured } from './supabaseClient'

/** 构建时是否包含 Supabase 配置(决定是否启用云端驱动) */
export const communityCloudConfigured = supabaseConfigured
import type { CommunityData, CommunityUser, FriendEdge, MeetingInvite } from '../types'
import { uid } from '../lib/misc'
import { flush, loadCommunity, subscribeCommunity } from './community'

const COMMUNITY_ROOM = 'community'

export type CommunityWireKind = 'friend_request' | 'meeting_invite' | 'dm'

export interface CommunityWire {
  kind: CommunityWireKind
  client_id: string
  id: string
  at: string
  /** friend_request / dm:发送者 */
  from?: CommunityUser
  /** friend_request / meeting_invite / dm:接收者账号 id */
  toId?: string
  /** meeting_invite:完整邀请对象 */
  invite?: MeetingInvite
  /** dm:消息内容 */
  body?: string
}

const myClientId = uid('cli')

/** 广播一条社区云端事件(env 未配置时静默跳过) */
export async function sendCommunityEvent(wire: Omit<CommunityWire, 'client_id'>): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    await supabase.from('rtc_message').insert({
      room_id: COMMUNITY_ROOM,
      sender_uid: null,
      payload: { ...wire, client_id: myClientId } satisfies CommunityWire,
    })
  } catch {
    // 跨设备同步失败不影响本机功能
  }
}

/** 接收侧:把云端事件合并进本地共享数据(去重) */
function applyWire(data: CommunityData, wire: CommunityWire, meId: string): boolean {
  switch (wire.kind) {
    case 'friend_request': {
      if (!wire.from || wire.toId !== meId) return false
      if (data.friends.some((f) => (f.a === wire.from!.id && f.b === meId) || (f.a === meId && f.b === wire.from!.id))) return false
      const edge: FriendEdge = { id: wire.id, a: wire.from.id, b: meId, since: wire.at }
      data.friends.push(edge)
      return true
    }
    case 'meeting_invite': {
      if (!wire.invite || wire.toId !== meId) return false
      if (data.invites.some((i) => i.meetingId === wire.invite!.meetingId && i.to === meId)) return false
      data.invites.unshift(wire.invite)
      return true
    }
    case 'dm': {
      if (!wire.from || wire.toId !== meId || !wire.body) return false
      data.messages.push({ id: wire.id, from: wire.from.id, to: wire.toId, body: wire.body, at: wire.at })
      return true
    }
    default:
      return false
  }
}

/** 订阅社区频道:收到别人的事件就并入本地存储(供页面挂载时启动) */
export function subscribeCommunityCloud(meId: string): () => void {
  const supabase = getSupabase()
  if (!supabase) return () => {}
  let myId = meId
  const channel = supabase
    .channel(COMMUNITY_ROOM)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'rtc_message', filter: `room_id=eq.${COMMUNITY_ROOM}` },
      (ev) => {
        const wire = (ev.new as { payload?: CommunityWire })?.payload
        if (!wire || wire.client_id === myClientId) return
        const data = loadCommunity()
        if (applyWire(data, wire, myId)) flush(data)
      }
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

/** 更新当前账号 id(登录切换后重挂订阅用) */
export function setCommunityCloudMe(meId: string): void {
  void meId
}

// —— 本地事件的云端镜像(在现有业务函数成功后调用) ——

export function cloudAddFriend(me: CommunityUser, other: CommunityUser): void {
  void sendCommunityEvent({ kind: 'friend_request', id: uid('f'), at: new Date().toISOString(), from: me, toId: other.id })
}

export function cloudSendInvite(invite: MeetingInvite, toId: string): void {
  void sendCommunityEvent({ kind: 'meeting_invite', id: invite.id, at: invite.at, invite, toId })
}

export function cloudSendDm(me: CommunityUser, to: CommunityUser, body: string, id: string, at: string): void {
  void sendCommunityEvent({ kind: 'dm', id, at, from: me, toId: to.id, body })
}

/** 供外部读取频道订阅状态(F12 验证用) */
export function communityChannelState(): string {
  const supabase = getSupabase()
  if (!supabase) return 'local-only'
  const ch = (supabase as unknown as { getChannels?: () => { state: string }[] }).getChannels?.() ?? []
  return ch.map((c) => c.state).join(',') || 'no-channel'
}

export const communityCloudDriver = {
  addFriend: cloudAddFriend,
  sendInvite: cloudSendInvite,
  sendDm: cloudSendDm,
  subscribe: subscribeCommunityCloud,
}

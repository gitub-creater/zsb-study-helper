// 社区云端事件层:好友请求 / 站内会议邀请 / 私信 的跨设备同步
// 统一走 rtc_message 表(room_id='community',anon 可写已配策略),接收端订阅 postgres_changes 合并进本地共享数据。
// 身份:本应用自有账号体系(payload 里带 CommunityUser),sender_uid 保持 null(auth.users 外键)。
import { getSupabase, supabaseConfigured } from './supabaseClient'

/** 构建时是否包含 Supabase 配置(决定是否启用云端驱动) */
export const communityCloudConfigured = supabaseConfigured
import type { CommunityData, CommunityGroup, CommunityUser, FriendRequest, GroupMessage, MeetingInvite } from '../types'
import { uid } from '../lib/misc'
import { applyFriendRequestResult, flush, isFriend, loadCommunity, subscribeCommunity } from './community'

const COMMUNITY_ROOM = 'community'

export type CommunityWireKind = 'friend_request' | 'friend_request_result' | 'meeting_invite' | 'dm' | 'group_upsert' | 'group_invite' | 'group_message'

export interface CommunityWire {
  kind: CommunityWireKind
  client_id: string
  id: string
  at: string
  /** friend_request / dm:发送者 */
  from?: CommunityUser
  /** friend_request / meeting_invite / dm:接收者账号 id */
  toId?: string
  /** friend_request:接收者公开资料,用于跨设备好友列表展示 */
  to?: CommunityUser
  /** friend_request_result:申请处理结果 */
  accepted?: boolean
  handledAt?: string
  /** meeting_invite:完整邀请对象 */
  invite?: MeetingInvite
  /** dm/group_message:消息内容 */
  body?: string
  /** group_upsert/group_invite/group_message:群组和群消息 */
  group?: CommunityGroup
  groupMessage?: GroupMessage
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
export function applyCommunityWire(data: CommunityData, wire: CommunityWire, meId: string): boolean {
  switch (wire.kind) {
    case 'friend_request': {
      if (!wire.from || wire.toId !== meId) return false
      if (isFriend(data, wire.from.id, meId)) return false
      const requests = data.friendRequests ?? (data.friendRequests = [])
      if (requests.some((request) => request.id === wire.id || (request.status === 'pending' && request.from.id === wire.from!.id && request.to.id === meId))) return false
      requests.unshift({ id: wire.id, from: wire.from, to: wire.to ?? { id: meId, name: '本账号', avatar: 'sprout' }, status: 'pending', at: wire.at })
      return true
    }
    case 'friend_request_result': {
      if (wire.toId !== meId || typeof wire.accepted !== 'boolean') return false
      return applyFriendRequestResult(data, wire.id, wire.accepted, wire.handledAt ?? wire.at)
    }
    case 'meeting_invite': {
      if (!wire.invite || wire.toId !== meId) return false
      if (data.invites.some((i) => i.meetingId === wire.invite!.meetingId && i.to === meId)) return false
      data.invites.unshift(wire.invite)
      return true
    }
    case 'dm': {
      if (!wire.from || wire.toId !== meId || !wire.body) return false
      if (data.messages.some((message) => message.id === wire.id)) return false
      data.messages.push({ id: wire.id, from: wire.from.id, to: wire.toId, body: wire.body, at: wire.at })
      return true
    }
    case 'group_upsert': {
      const group = wire.group
      if (!group || (!group.memberIds.includes(meId) && group.ownerId !== meId)) return false
      const current = data.groups ?? (data.groups = [])
      const index = current.findIndex((item) => item.id === group.id)
      if (index >= 0) current[index] = group
      else current.push(group)
      return true
    }
    case 'group_invite': {
      const group = wire.group
      if (!group || wire.toId !== meId) return false
      const current = data.groups ?? (data.groups = [])
      if (!current.some((item) => item.id === group.id)) current.push(group)
      return true
    }
    case 'group_message': {
      const message = wire.groupMessage
      const group = message ? (data.groups ?? []).find((item) => item.id === message.groupId) : undefined
      if (!message || !group || !group.memberIds.includes(meId)) return false
      const current = data.groupMessages ?? (data.groupMessages = [])
      if (current.some((item) => item.id === message.id)) return false
      current.push(message)
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
        if (applyCommunityWire(data, wire, myId)) flush(data)
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

export function cloudAddFriend(me: CommunityUser, other: CommunityUser, requestId: string): void {
  void sendCommunityEvent({ kind: 'friend_request', id: requestId, at: new Date().toISOString(), from: me, toId: other.id, to: other })
}

export function cloudRespondFriendRequest(request: FriendRequest, accept: boolean): void {
  void sendCommunityEvent({
    kind: 'friend_request_result',
    id: request.id,
    at: request.handledAt ?? new Date().toISOString(),
    toId: request.from.id,
    accepted: accept,
    handledAt: request.handledAt,
  })
}

export function cloudSendInvite(invite: MeetingInvite, toId: string): void {
  void sendCommunityEvent({ kind: 'meeting_invite', id: invite.id, at: invite.at, invite, toId })
}

export function cloudSendDm(me: CommunityUser, to: CommunityUser, body: string, id: string, at: string): void {
  void sendCommunityEvent({ kind: 'dm', id, at, from: me, toId: to.id, body })
}

export function cloudUpsertGroup(group: CommunityGroup): void {
  void sendCommunityEvent({ kind: 'group_upsert', id: group.id, at: group.createdAt, group })
}

export function cloudInviteToGroup(group: CommunityGroup, toId: string): void {
  void sendCommunityEvent({ kind: 'group_invite', id: uid('gi'), at: new Date().toISOString(), group, toId })
}

export function cloudSendGroupMessage(message: GroupMessage): void {
  void sendCommunityEvent({ kind: 'group_message', id: message.id, at: message.at, groupMessage: message })
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
  upsertGroup: cloudUpsertGroup,
  inviteToGroup: cloudInviteToGroup,
  sendGroupMessage: cloudSendGroupMessage,
  subscribe: subscribeCommunityCloud,
}

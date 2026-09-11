import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Modal, useToast } from '../components/ui'
import { addGroupMembers, createGroup, friendsOf, getUserGroups, groupMessages, joinGroup, leaveGroup, loadCommunity, sendGroupMessage, subscribeCommunity } from '../services/community'
import { cloudInviteToGroup, cloudSendGroupMessage, cloudUpsertGroup } from '../services/communityCloud'
import type { CommunityGroup, CommunityUser } from '../types'
import { AVATAR_INFO } from '../lib/theme'
import './GroupsPage.css'

export default function GroupsPage({ me }: { me: CommunityUser }) {
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<CommunityGroup | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const data = useMemo(() => loadCommunity(), [tick])
  const groups = getUserGroups(data, me.id)
  useEffect(() => subscribeCommunity(() => setTick((value) => value + 1)), [])

  return (
    <div className="page groups-page">
      <div className="groups-head">
        <div>
          <h2>学习群组</h2>
          <p className="muted">和好友一起交流题目，发起会议共同学习。</p>
        </div>
        <div className="groups-head-actions"><button className="btn" onClick={() => setJoinOpen(true)}>加入群组</button><button className="btn btn-primary" onClick={() => setCreateOpen(true)}>创建群组</button></div>
      </div>
      {groups.length === 0 ? (
        <div className="card groups-empty">
          <b>还没有加入群组</b>
          <p className="muted">创建一个学习群，邀请好友一起备考。</p>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>创建第一个群组</button>
        </div>
      ) : (
        <div className="groups-grid">
          {groups.map((group) => (
            <button type="button" className="card group-card" key={group.id} onClick={() => setSelected(group)}>
              <div className="group-avatar">{group.name.slice(0, 1)}</div>
              <div className="group-card-main"><b>{group.name}</b><span className="muted fs12">{group.memberIds.length} 位成员</span>{group.description && <p className="muted">{group.description}</p>}</div>
            </button>
          ))}
        </div>
      )}
      {createOpen && <CreateGroupModal me={me} onClose={() => setCreateOpen(false)} />}
      {joinOpen && <JoinGroupModal me={me} onClose={() => setJoinOpen(false)} />}
      {selected && <GroupChatModal me={me} group={selected} data={data} onClose={() => setSelected(null)} />}
    </div>
  )
}

function CreateGroupModal({ me, onClose }: { me: CommunityUser; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const toast = useToast()
  const submit = () => {
    try { const group = createGroup(me, name, description); cloudUpsertGroup(group); toast('群组创建成功，可复制群组编号邀请好友', { kind: 'success' }); onClose() }
    catch (error) { toast(error instanceof Error ? error.message : '创建失败', { kind: 'error' }) }
  }
  return <Modal open title="创建学习群组" onClose={onClose} width={440} footer={<><button className="btn" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={submit}>创建</button></>}>
    <div className="col">
      <label className="field"><span className="field-l">群组名称</span><input className="input" value={name} maxLength={30} placeholder="例如：高数冲刺小组" onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><span className="field-l">群组说明</span><textarea className="input" rows={3} maxLength={120} placeholder="说明学习方向或约定" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    </div>
  </Modal>
}

function JoinGroupModal({ me, onClose }: { me: CommunityUser; onClose: () => void }) {
  const [groupId, setGroupId] = useState('')
  const toast = useToast()
  const submit = () => {
    try { joinGroup(groupId.trim(), me.id); toast('已加入群组', { kind: 'success' }); onClose() }
    catch (error) { toast(error instanceof Error ? error.message : '加入失败', { kind: 'error' }) }
  }
  return <Modal open title="加入学习群组" onClose={onClose} width={420} footer={<><button className="btn" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={submit}>加入</button></>}>
    <label className="field"><span className="field-l">群组编号</span><input className="input" value={groupId} placeholder="粘贴群主分享的群组编号" onChange={(event) => setGroupId(event.target.value)} /></label>
  </Modal>
}

function InviteGroupMembersModal({ me, group, data, onClose }: { me: CommunityUser; group: CommunityGroup; data: ReturnType<typeof loadCommunity>; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const toast = useToast()
  const candidates = friendsOf(data, me.id).filter((friend) => !group.memberIds.includes(friend.id))
  const submit = () => {
    if (selected.length === 0) { toast('请选择至少一位好友', { kind: 'error' }); return }
    const updated = addGroupMembers(group.id, me.id, selected)
    selected.forEach((id) => cloudInviteToGroup(updated, id))
    cloudUpsertGroup(updated)
    toast(`已邀请 ${selected.length} 位好友加入群组`, { kind: 'success' })
    onClose()
  }
  return <Modal open title="邀请好友加入群组" onClose={onClose} width={440} footer={<><button className="btn" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={submit}>发送邀请</button></>}>
    {candidates.length === 0 ? <p className="muted">暂无可邀请的好友，请先添加好友。</p> : <div className="invite-select-list">{candidates.map((friend) => <label className="check-row" key={friend.id}><input type="checkbox" checked={selected.includes(friend.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, friend.id] : ids.filter((id) => id !== friend.id))} /><Avatar kind={friend.avatar} color={AVATAR_INFO[friend.avatar].color} size={26} />{friend.name}</label>)}</div>}
  </Modal>
}

function GroupChatModal({ me, group, data: initialData, onClose }: { me: CommunityUser; group: CommunityGroup; data: ReturnType<typeof loadCommunity>; onClose: () => void }) {
  const [tick, setTick] = useState(0)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [body, setBody] = useState('')
  const toast = useToast()
  const data = useMemo(() => loadCommunity(), [tick])
  const messages = groupMessages(data, group.id, me.id)
  useEffect(() => subscribeCommunity(() => setTick((value) => value + 1)), [])
  const submit = () => { try { const message = sendGroupMessage(group.id, me, body); cloudSendGroupMessage(message); setBody('') } catch (error) { toast(error instanceof Error ? error.message : '发送失败', { kind: 'error' }) } }
  const exit = () => { try { leaveGroup(group.id, me.id); toast('已退出群组', { kind: 'success' }); onClose() } catch (error) { toast(error instanceof Error ? error.message : '操作失败', { kind: 'error' }) } }
  return <Modal open title={group.name} onClose={onClose} width={620} footer={<><button className="btn" onClick={() => setInviteOpen(true)}>邀请好友</button><button className="btn btn-danger" onClick={exit}>退出群组</button><button className="btn" onClick={onClose}>关闭</button></>}>
    {inviteOpen && <InviteGroupMembersModal me={me} group={group} data={data} onClose={() => setInviteOpen(false)} />}
    <div className="group-chat"><div className="group-chat-meta"><span>{group.memberIds.length} 位成员</span><span className="muted">{group.description}</span><span className="muted fs12">群组编号：{group.id}</span></div><div className="group-messages">{messages.length === 0 ? <p className="muted">还没有消息，先打个招呼吧。</p> : messages.map((message) => <div className={`group-message ${message.from.id === me.id ? 'mine' : ''}`} key={message.id}><Avatar kind={message.from.avatar} color={AVATAR_INFO[message.from.avatar].color} size={26} /><div><b>{message.from.id === me.id ? '我' : message.from.name}</b><p>{message.body}</p><span className="muted fs12">{new Date(message.at).toLocaleString('zh-CN')}</span></div></div>)}</div><div className="group-compose"><textarea className="input" rows={2} value={body} placeholder="发送学习消息..." onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} /><button className="btn btn-primary" onClick={submit}>发送</button></div></div>
  </Modal>
}

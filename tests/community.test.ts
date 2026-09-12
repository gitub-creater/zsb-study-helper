// 问题社区数据层测试:发帖/悬赏/最佳答案/解答时间/筛选排序
// services/community.ts 依赖浏览器 localStorage 与 window 事件,这里做最小 stub
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CommunityData, CommunityPost } from '../src/types'

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
})
vi.stubGlobal('window', {
  setTimeout,
  clearTimeout,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
})

import {
  addComment,
  addFriend,
  addGroupMembers,
  applyForTutoring,
  commentTree,
  createGroup,
  emptyCommunity,
  groupMessages,
  isFriend,
  pendingFriendRequests,
  sendGroupMessage,
  createPost,
  getCredits,
  hotScore,
  loadCommunity,
  markBestAnswer,
  queryPosts,
  respondFriendRequest,
  solveDuration,
  tutoringAction,
  togglePostLike,
} from '../src/services/community'
import { applyCommunityWire, replayCommunityWires } from '../src/services/communityCloud'

const me = { id: 'u_me', name: '测试生', avatar: 'sprout' as const }
const other = { id: 'u_other', name: '帮手同学', avatar: 'cat' as const }

beforeAll(() => {
  localStorage.clear()
})

function freshData(): CommunityData {
  localStorage.clear()
  return loadCommunity()
}

function makePost(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 'q_t1',
    author: other,
    anonymous: false,
    title: '测试问题标题',
    body: '问题描述',
    subject: '高等数学Ⅰ',
    tags: ['极限'],
    images: [],
    attachments: [],
    bounty: 0,
    status: 'open',
    createdAt: new Date().toISOString(),
    views: 1,
    likes: 0,
    likedBy: [],
    bookmarks: [],
    reports: [],
    ...overrides,
  }
}

describe('社区:发帖与悬赏', () => {
  it('发帖扣除悬赏积分,积分不足时拒绝', () => {
    freshData()
    const post = createPost({ me, title: '泰勒展开取几阶?', body: '卡在二阶展开,求详细步骤。', subject: '高等数学Ⅰ', tags: ['极限'], images: [], attachments: [], anonymous: false, bounty: 30 })
    expect(getCredits(loadCommunity(), me.id)).toBe(70) // 100 - 30
    expect(() => createPost({ me, title: '再问一个', body: '积分不够也要发。', subject: '英语', tags: [], images: [], attachments: [], anonymous: false, bounty: 9999 })).toThrow(/积分不足/)
    expect(loadCommunity().posts.some((p) => p.id === post.id)).toBe(true)
  })

  it('回答让问题进入"待采纳"并记录首次解答时间', () => {
    freshData()
    const post = createPost({ me, title: '如何区分 since 和 for?', body: '完成时里两个词总混,求判断口诀。', subject: '英语', tags: ['语法'], images: [], attachments: [], anonymous: false, bounty: 0 })
    addComment(post.id, other, 'for + 时间段,since + 时间起点。', false)
    const data = loadCommunity()
    const p = data.posts.find((x) => x.id === post.id)!
    expect(p.status).toBe('answered')
    expect(p.firstAnswerAt).toBeTruthy()
  })

  it('采纳最佳答案转移悬赏积分,并结束问题', () => {
    freshData()
    const post = createPost({ me, title: 'RANK 函数绝对引用?', body: '下拉时排名范围变了,怎么加 $ 符号?', subject: '计算机基础', tags: ['Excel'], images: [], attachments: [], anonymous: false, bounty: 20 })
    const c = addComment(post.id, other, '把范围锁定为 $C$2:$C$16。', false)
    markBestAnswer(post.id, c.id, me)
    const data = loadCommunity()
    const p = data.posts.find((x) => x.id === post.id)!
    expect(p.status).toBe('solved')
    expect(p.solvedAt).toBeTruthy()
    expect(getCredits(data, other.id)).toBe(120) // 100 + 20
    expect(getCredits(data, me.id)).toBe(80)
  })

  it('点赞去重', () => {
    freshData()
    const post = createPost({ me, title: '普通问题', body: '没有人回答的问题。', subject: '英语', tags: [], images: [], attachments: [], anonymous: false, bounty: 0 })
    togglePostLike(post.id, other.id)
    togglePostLike(post.id, other.id)
    expect(loadCommunity().posts.find((p) => p.id === post.id)!.likes).toBe(0)
  })
})

describe('社区:好友申请', () => {
  it('发送申请不建立好友关系,接收方接受后才建立且重复事件幂等', () => {
    freshData()
    const request = addFriend(me, other)
    let data = loadCommunity()
    expect(isFriend(data, me.id, other.id)).toBe(false)
    expect(pendingFriendRequests(data, me.id)).toHaveLength(1)
    expect(() => addFriend(me, other)).toThrow(/已发送/)

    const received = { ...data, friendRequests: [] }
    const wire = { kind: 'friend_request' as const, client_id: 'remote', id: request.id, at: request.at, from: me, toId: other.id }
    expect(applyCommunityWire(received, wire, other.id)).toBe(true)
    expect(applyCommunityWire(received, wire, other.id)).toBe(false)
    expect(isFriend(received, me.id, other.id)).toBe(false)

    const accepted = respondFriendRequest(other.id, request.id, true)
    data = loadCommunity()
    expect(accepted.status).toBe('accepted')
    expect(isFriend(data, me.id, other.id)).toBe(true)
  })

  it('拒绝申请不建立好友,非接收方不能处理', () => {
    freshData()
    const request = addFriend(me, other)
    expect(() => respondFriendRequest(me.id, request.id, true)).toThrow(/接收方/)
    const declined = respondFriendRequest(other.id, request.id, false)
    expect(declined.status).toBe('declined')
    expect(isFriend(loadCommunity(), me.id, other.id)).toBe(false)
  })

  it('旧社区数据缺少申请数组时仍可加载', () => {
    mem.set('zsb_community_v1', JSON.stringify({ version: 1, posts: [], comments: [], tutoring: [], friends: [], messages: [], invites: [], credits: {} }))
    expect(loadCommunity().friendRequests).toEqual([])
  })

  it('离线回放:历史申请与结果按序合并,发起方最终建立好友', () => {
    freshData()
    const request = addFriend(me, other)
    // 接收方是另一台设备:本地没有这条申请,回放后出现待处理申请
    const receiver = emptyCommunity()
    const wires = [
      { kind: 'friend_request' as const, client_id: 'sender_cli', id: request.id, at: request.at, from: me, toId: other.id, to: other },
      { kind: 'friend_request_result' as const, client_id: 'receiver_cli', id: request.id, at: new Date().toISOString(), toId: me.id, accepted: true, handledAt: new Date().toISOString() },
    ]
    expect(replayCommunityWires(receiver, wires, other.id)).toBe(1)
    expect(receiver.friendRequests?.[0].status).toBe('pending')
    // 接收方接受后,发起方设备回放结果:申请标记 accepted 并建立好友
    const sender = loadCommunity()
    expect(replayCommunityWires(sender, [wires[1]], me.id)).toBe(1)
    expect(sender.friendRequests?.find((r) => r.id === request.id)?.status).toBe('accepted')
    expect(isFriend(sender, me.id, other.id)).toBe(true)
    // 重复回放幂等,不会重复建边
    expect(replayCommunityWires(sender, [wires[1]], me.id)).toBe(0)
    expect(sender.friends.filter((f) => (f.a === me.id && f.b === other.id) || (f.a === other.id && f.b === me.id))).toHaveLength(1)
  })
})

describe('社区:学习群组', () => {
  it('创建群组、邀请成员并发送群消息', () => {
    freshData()
    const group = createGroup(me, '高数冲刺', '一起练习极限')
    expect(group.memberIds).toEqual([me.id])
    expect(() => sendGroupMessage(group.id, other, '未加入')).toThrow(/不是该群组成员/)
    const updated = addGroupMembers(group.id, me.id, [other.id, other.id])
    expect(updated.memberIds).toEqual([me.id, other.id])
    const message = sendGroupMessage(group.id, other, '今天练二阶导数')
    expect(groupMessages(loadCommunity(), group.id, other.id)).toEqual([message])
  })
})

describe('社区:解答时间', () => {
  it('不能申请解答自己的问题;结束时间必须晚于开始', () => {
    freshData()
    const post = createPost({ me, title: '自我解答测试', body: '这个问题是我自己发的。', subject: '英语', tags: [], images: [], attachments: [], anonymous: false, bounty: 0 })
    expect(() => applyForTutoring(post.id, me, new Date().toISOString(), new Date(Date.now() + 3600000).toISOString(), '')).toThrow(/自己的问题/)
    expect(() => applyForTutoring(post.id, other, new Date().toISOString(), new Date(Date.now() - 3600000).toISOString(), '')).toThrow(/晚于/)
  })

  it('提问者接受后解答者才能开始;只有解答者能结束', () => {
    freshData()
    const post = createPost({ me, title: '解答流程测试', body: '验证 accept → start → finish 状态机。', subject: '英语', tags: [], images: [], attachments: [], anonymous: false, bounty: 0 })
    const start = new Date(Date.now() + 60000).toISOString()
    const end = new Date(Date.now() + 3600000).toISOString()
    const t = applyForTutoring(post.id, other, start, end, '线上讲题')
    // 解答者不能自己接受
    expect(() => tutoringAction({ kind: 'accept', sessionId: t.id, by: other })).toThrow(/提问者/)
    tutoringAction({ kind: 'accept', sessionId: t.id, by: me })
    // 未接受前不能开始
    expect(() => tutoringAction({ kind: 'start', sessionId: t.id, by: me })).toThrow()
    tutoringAction({ kind: 'start', sessionId: t.id, by: other })
    const data = loadCommunity()
    const session = data.tutoring.find((x) => x.id === t.id)!
    expect(session.status).toBe('active')
    expect(session.actualStart).toBeTruthy()
    // 提问者不能替解答者结束
    expect(() => tutoringAction({ kind: 'finish', sessionId: t.id, by: me })).toThrow(/解答者/)
    tutoringAction({ kind: 'finish', sessionId: t.id, by: other })
    expect(loadCommunity().tutoring.find((x) => x.id === t.id)!.status).toBe('finished')
  })

  it('重复申请被拒绝', () => {
    freshData()
    const post = createPost({ me, title: '重复申请测试', body: '同一个人不能申请两次。', subject: '英语', tags: [], images: [], attachments: [], anonymous: false, bounty: 0 })
    const start = new Date(Date.now() + 60000).toISOString()
    const end = new Date(Date.now() + 3600000).toISOString()
    applyForTutoring(post.id, other, start, end, '')
    expect(() => applyForTutoring(post.id, other, start, end, '')).toThrow(/已申请/)
  })
})

describe('社区:筛选与排序(纯函数)', () => {
  const data = { ...loadCommunity() }
  it('queryPosts 按文本/状态筛选', () => {
    const posts = [
      makePost({ id: 'q1', title: '泰勒展开求极限', status: 'open', createdAt: '2026-09-01T10:00:00Z', subject: '高等数学Ⅰ', tags: ['极限'] }),
      makePost({ id: 'q2', title: '英语作文模板', status: 'solved', createdAt: '2026-09-02T10:00:00Z', subject: '英语', tags: ['作文'] }),
      makePost({ id: 'q3', title: 'RANK 函数', status: 'open', createdAt: '2026-09-03T10:00:00Z', bounty: 15, subject: '计算机基础', tags: [] }),
    ]
    const d = { ...data, posts }
    expect(queryPosts(d, { text: '极限' }).map((p) => p.id)).toEqual(['q1'])
    expect(queryPosts(d, { status: 'open' }).map((p) => p.id)).toEqual(['q3', 'q1'])
    expect(queryPosts(d, { sort: 'bounty' })[0].id).toBe('q3')
    expect(queryPosts(d, { sort: 'latest' })[0].id).toBe('q3')
    expect(queryPosts(d, { tag: '作文' }).map((p) => p.id)).toEqual(['q2'])
    expect(queryPosts(d, { sort: 'unresolved' }).every((p) => p.status !== 'solved')).toBe(true)
  })

  it('hotScore 随互动增加而提高,随时间衰减', () => {
    const now = Date.now()
    const fresh = makePost({ likes: 5, views: 50, createdAt: new Date(now - 3600_000).toISOString() })
    const stale = makePost({ likes: 5, views: 50, createdAt: new Date(now - 100 * 86400_000).toISOString() })
    const hot = makePost({ likes: 50, views: 500, createdAt: fresh.createdAt })
    expect(hotScore(hot)).toBeGreaterThan(hotScore(fresh))
    expect(hotScore(fresh)).toBeGreaterThan(hotScore(stale))
  })

  it('solveDuration 计算解决耗时', () => {
    const p = makePost({ createdAt: '2026-09-01T10:00:00Z', solvedAt: '2026-09-01T11:30:00Z' })
    expect(solveDuration(p)).toBe('1 小时 30 分')
    expect(solveDuration(makePost({ createdAt: '2026-09-01T10:00:00Z' }))).toBeNull()
  })

  it('commentTree 组织楼中楼', () => {
    const d = {
      ...data,
      comments: [
        { id: 'c1', postId: 'q1', author: other, anonymous: false, body: '顶层', createdAt: '2026-09-01T10:00:00Z', likes: 0, likedBy: [] },
        { id: 'c2', postId: 'q1', parentId: 'c1', author: me, anonymous: false, body: '楼中楼', createdAt: '2026-09-01T10:01:00Z', likes: 0, likedBy: [] },
      ],
    } as CommunityData
    const tree = commentTree(d, 'q1')
    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c) => c.id)).toEqual(['c2'])
  })
})

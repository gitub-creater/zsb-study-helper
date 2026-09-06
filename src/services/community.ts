// 问题社区数据层(本机共享版)
//
// 说明:社区数据存放在 localStorage 的 `zsb_community_v1`,当前设备上的所有账号共用,
// 因此发帖/回答/点赞/私信在本机多账号之间是真实互通的。
// 跨设备/跨网络社区需要一个后端(如 Supabase 表 + api/ 下的 serverless 接口):
// CommunityStore 接口已把全部操作抽象成方法,接后端时只需新增一个 RemoteDriver 实现
// (表结构建议:posts / comments / tutoring / friends / messages / invites / credits),UI 层零改动。
import type { CommunityComment, CommunityData, CommunityPost, CommunityUser, FriendEdge, MeetingInvite, PostStatus, TutoringSession } from '../types'
import { uid } from '../lib/misc'

const KEY = 'zsb_community_v1'
export const COMMUNITY_CHANGE_EVENT = 'zsb-community-change'
const DATA_VERSION = 1
/** 新用户赠送积分(可发悬赏) */
export const START_CREDITS = 100

export function emptyCommunity(): CommunityData {
  return { version: DATA_VERSION, posts: [], comments: [], tutoring: [], friends: [], messages: [], invites: [], credits: {}, seeded: false }
}

export function loadCommunity(): CommunityData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CommunityData>
      return {
        ...emptyCommunity(),
        ...parsed,
        credits: parsed.credits ?? {},
        posts: parsed.posts ?? [],
        comments: parsed.comments ?? [],
        tutoring: parsed.tutoring ?? [],
        friends: parsed.friends ?? [],
        messages: parsed.messages ?? [],
        invites: parsed.invites ?? [],
      }
    }
  } catch {
    // 数据损坏时重建
  }
  const seeded = seedCommunity()
  return seeded
}

let saveTimer: number | undefined

function saveCommunity(data: CommunityData): void {
  // 防抖写盘 + 广播变更事件(同页与跨 tab 的 storage 事件都触发刷新)
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      // 配额不足(通常是大图):抛给上层提示
      window.dispatchEvent(new CustomEvent(COMMUNITY_CHANGE_EVENT, { detail: { error: 'quota' } }))
      return
    }
    window.dispatchEvent(new CustomEvent(COMMUNITY_CHANGE_EVENT))
  }, 120)
}

/** 立即写盘(发帖等关键操作) */
export function flush(data: CommunityData): void {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    window.dispatchEvent(new CustomEvent(COMMUNITY_CHANGE_EVENT, { detail: { error: 'quota' } }))
    return
  }
  window.dispatchEvent(new CustomEvent(COMMUNITY_CHANGE_EVENT))
}

export function subscribeCommunity(cb: () => void): () => void {
  const h = () => cb()
  window.addEventListener(COMMUNITY_CHANGE_EVENT, h)
  window.addEventListener('storage', h)
  return () => {
    window.removeEventListener(COMMUNITY_CHANGE_EVENT, h)
    window.removeEventListener('storage', h)
  }
}

function mutate<T>(fn: (d: CommunityData) => T, immediate = false): T {
  const data = loadCommunity()
  const out = fn(data)
  if (immediate) flush(data)
  else saveCommunity(data)
  return out
}

// ---------- 积分 ----------

export function getCredits(data: CommunityData, userId: string): number {
  return data.credits[userId] ?? START_CREDITS
}

function addCredits(data: CommunityData, userId: string, delta: number): void {
  data.credits[userId] = Math.max(0, getCredits(data, userId) + delta)
}

// ---------- 发帖 ----------

export interface NewPostInput {
  me: CommunityUser
  title: string
  body: string
  subject: string
  kpName?: string
  tags: string[]
  images: string[]
  attachments: { name: string; dataUrl: string; size: number }[]
  anonymous: boolean
  bounty: number
}

export function createPost(input: NewPostInput): CommunityPost {
  return mutate((d) => {
    const bounty = Math.max(0, Math.min(999, Math.round(input.bounty)))
    if (bounty > getCredits(d, input.me.id)) throw new Error('积分不足,无法设置该悬赏')
    const post: CommunityPost = {
      id: uid('q'),
      author: input.me,
      anonymous: input.anonymous,
      title: input.title.trim(),
      body: input.body.trim(),
      subject: input.subject,
      kpName: input.kpName?.trim() || undefined,
      tags: input.tags,
      images: input.images,
      attachments: input.attachments,
      bounty,
      status: 'open',
      createdAt: new Date().toISOString(),
      views: 0,
      likes: 0,
      likedBy: [],
      bookmarks: [],
      reports: [],
    }
    if (bounty > 0) addCredits(d, input.me.id, -bounty)
    d.posts.unshift(post)
    return post
  }, true)
}

export function openPost(postId: string): void {
  mutate((d) => {
    const p = d.posts.find((x) => x.id === postId)
    if (p) p.views++
  })
}

export function deletePost(postId: string, me: CommunityUser): void {
  mutate((d) => {
    const p = d.posts.find((x) => x.id === postId)
    if (!p || p.author.id !== me.id) throw new Error('只能删除自己的帖子')
    if (p.bounty > 0 && p.status !== 'solved') addCredits(d, me.id, p.bounty)
    d.posts = d.posts.filter((x) => x.id !== postId)
    d.comments = d.comments.filter((c) => c.postId !== postId)
    d.tutoring = d.tutoring.filter((t) => t.postId !== postId)
  }, true)
}

// ---------- 评论 / 回复 / 楼中楼 ----------

export function addComment(postId: string, me: CommunityUser, body: string, anonymous: boolean, parentId?: string): CommunityComment {
  return mutate((d) => {
    const post = d.posts.find((x) => x.id === postId)
    if (!post) throw new Error('问题不存在或已被删除')
    if (parentId) {
      const parent = d.comments.find((c) => c.id === parentId)
      if (!parent) throw new Error('要回复的评论不存在')
    }
    const c: CommunityComment = {
      id: uid('c'),
      postId,
      parentId,
      author: me,
      anonymous,
      body: body.trim(),
      createdAt: new Date().toISOString(),
      likes: 0,
      likedBy: [],
    }
    d.comments.push(c)
    if (!parentId && post.status === 'open') {
      post.status = 'answered'
      post.firstAnswerAt = c.createdAt
    }
    return c
  }, true)
}

export function toggleCommentLike(commentId: string, meId: string): void {
  mutate((d) => {
    const c = d.comments.find((x) => x.id === commentId)
    if (!c) return
    if (c.likedBy.includes(meId)) {
      c.likedBy = c.likedBy.filter((x) => x !== meId)
      c.likes = Math.max(0, c.likes - 1)
    } else {
      c.likedBy = [...c.likedBy, meId]
      c.likes++
    }
  })
}

export function markBestAnswer(postId: string, commentId: string, me: CommunityUser): void {
  mutate((d) => {
    const post = d.posts.find((x) => x.id === postId)
    const comment = d.comments.find((x) => x.id === commentId)
    if (!post || !comment) throw new Error('问题或回答不存在')
    if (post.author.id !== me.id) throw new Error('只有提问者可以采纳最佳答案')
    if (post.status === 'solved') throw new Error('该问题已解决')
    post.status = 'solved'
    post.solvedAt = new Date().toISOString()
    post.bestCommentId = commentId
    comment.best = true
    if (post.bounty > 0) addCredits(d, comment.author.id, post.bounty)
  }, true)
}

export function togglePostLike(postId: string, meId: string): void {
  mutate((d) => {
    const p = d.posts.find((x) => x.id === postId)
    if (!p) return
    if (p.likedBy.includes(meId)) {
      p.likedBy = p.likedBy.filter((x) => x !== meId)
      p.likes = Math.max(0, p.likes - 1)
    } else {
      p.likedBy = [...p.likedBy, meId]
      p.likes++
    }
  })
}

export function toggleBookmark(postId: string, meId: string): void {
  mutate((d) => {
    const p = d.posts.find((x) => x.id === postId)
    if (!p) return
    p.bookmarks = p.bookmarks.includes(meId) ? p.bookmarks.filter((x) => x !== meId) : [...p.bookmarks, meId]
  })
}

export function reportPost(postId: string, meId: string, reason: string): void {
  mutate((d) => {
    const p = d.posts.find((x) => x.id === postId)
    if (!p) return
    if (!p.reports.some((r) => r.by === meId)) p.reports.push({ by: meId, reason, at: new Date().toISOString() })
  }, true)
}

// ---------- 解答时间(一对一答疑) ----------

export function applyForTutoring(postId: string, tutor: CommunityUser, startIso: string, endIso: string, note: string): TutoringSession {
  return mutate((d) => {
    const post = d.posts.find((x) => x.id === postId)
    if (!post) throw new Error('问题不存在')
    if (post.author.id === tutor.id) throw new Error('不能申请解答自己的问题')
    if (d.tutoring.some((t) => t.postId === postId && t.tutor.id === tutor.id && ['pending', 'accepted', 'active'].includes(t.status))) {
      throw new Error('你已申请过该问题的解答,请等待提问者处理')
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) throw new Error('预计结束时间必须晚于开始时间')
    const t: TutoringSession = {
      id: uid('t'),
      postId,
      tutor,
      student: post.author,
      status: 'pending',
      proposedStart: startIso,
      proposedEnd: endIso,
      note: note.trim() || undefined,
      history: [{ at: new Date().toISOString(), by: tutor.id, text: '申请了解答时间' }],
      createdAt: new Date().toISOString(),
    }
    d.tutoring.unshift(t)
    return t
  }, true)
}

export type TutoringOp =
  | { kind: 'accept' | 'reject' | 'cancel'; sessionId: string; by: CommunityUser }
  | { kind: 'start' | 'finish'; sessionId: string; by: CommunityUser }
  | { kind: 'reschedule'; sessionId: string; by: CommunityUser; startIso: string; endIso: string }

const TUTORING_STUDENT_ACTIONS = ['accept', 'reject', 'cancel'] as const

export function tutoringAction(op: TutoringOp): void {
  mutate((d) => {
    const t = d.tutoring.find((x) => x.id === op.sessionId)
    if (!t) throw new Error('解答约定不存在')
    const isStudent = t.student.id === op.by.id
    const isTutor = t.tutor.id === op.by.id
    const log = (text: string) => t.history.unshift({ at: new Date().toISOString(), by: op.by.id, text })
    switch (op.kind) {
      case 'accept':
      case 'reject':
        if (!isStudent) throw new Error('只有提问者可以处理该申请')
        if (t.status !== 'pending') throw new Error('该申请已被处理')
        t.status = op.kind === 'accept' ? 'accepted' : 'rejected'
        log(op.kind === 'accept' ? '提问者接受了申请' : '提问者拒绝了申请')
        break
      case 'cancel':
        if (!isStudent && !isTutor) throw new Error('无权操作')
        if (['finished', 'cancelled', 'rejected'].includes(t.status)) throw new Error('该约定已结束')
        t.status = 'cancelled'
        log('取消了解答约定')
        break
      case 'start':
        if (!isTutor) throw new Error('只有解答者可以开始解答')
        if (t.status !== 'accepted') throw new Error('请先等提问者接受申请')
        t.status = 'active'
        t.actualStart = new Date().toISOString()
        log('解答开始')
        break
      case 'finish':
        if (!isTutor) throw new Error('只有解答者可以结束解答')
        if (t.status !== 'active') throw new Error('解答尚未开始')
        t.status = 'finished'
        t.actualEnd = new Date().toISOString()
        log('解答结束,等待双方评价')
        break
      case 'reschedule': {
        if (!isStudent && !isTutor) throw new Error('无权操作')
        if (!['pending', 'accepted'].includes(t.status)) throw new Error('当前状态不能改期')
        if (new Date(op.endIso).getTime() <= new Date(op.startIso).getTime()) throw new Error('预计结束时间必须晚于开始时间')
        t.proposedStart = op.startIso
        t.proposedEnd = op.endIso
        log(`调整解答时间:${op.startIso.slice(5, 16).replace('T', ' ')} 起`)
        break
      }
    }
  }, true)
}

export function rateTutoring(sessionId: string, by: CommunityUser, stars: number, comment: string): void {
  mutate((d) => {
    const t = d.tutoring.find((x) => x.id === sessionId)
    if (!t) throw new Error('解答约定不存在')
    if (t.status !== 'finished') throw new Error('解答结束后才能评价')
    const isStudent = t.student.id === by.id
    const isTutor = t.tutor.id === by.id
    if (!isStudent && !isTutor) throw new Error('只有当事人可以评价')
    t.rating = { ...(t.rating ?? {}) }
    if (isStudent) {
      if (t.rating.studentStars) throw new Error('你已评价过')
      t.rating.studentStars = stars
      t.rating.studentComment = comment.trim() || undefined
    } else {
      if (t.rating.tutorStars) throw new Error('你已评价过')
      t.rating.tutorStars = stars
      t.rating.tutorComment = comment.trim() || undefined
    }
    t.rating.ratedAt = new Date().toISOString()
    t.history.unshift({ at: new Date().toISOString(), by: by.id, text: '提交了评价' })
  }, true)
}

/** 解答耗时(人类可读);未结束时返回 null */
export function solveDuration(post: CommunityPost): string | null {
  if (!post.solvedAt) return null
  const ms = new Date(post.solvedAt).getTime() - new Date(post.createdAt).getTime()
  const mins = Math.max(1, Math.round(ms / 60000))
  if (mins < 60) return `${mins} 分钟`
  const hours = Math.floor(mins / 60)
  return `${hours} 小时 ${mins % 60} 分`
}

// ---------- 好友与私信 ----------

export function addFriend(me: CommunityUser, other: CommunityUser): void {
  mutate((d) => {
    if (me.id === other.id) throw new Error('不能添加自己为好友')
    if (d.friends.some((f) => (f.a === me.id && f.b === other.id) || (f.a === other.id && f.b === me.id))) return
    d.friends.push({ id: uid('f'), a: me.id, b: other.id, since: new Date().toISOString() })
  }, true)
}

export function removeFriend(meId: string, otherId: string): void {
  mutate((d) => {
    d.friends = d.friends.filter((f) => !((f.a === meId && f.b === otherId) || (f.a === otherId && f.b === meId)))
  }, true)
}

export function isFriend(data: CommunityData, a: string, b: string): boolean {
  return data.friends.some((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a))
}

export function sendDm(from: CommunityUser, to: CommunityUser, body: string): void {
  mutate((d) => {
    const text = body.trim()
    if (!text) throw new Error('消息内容不能为空')
    d.messages.push({ id: uid('m'), from: from.id, to: to.id, body: text, at: new Date().toISOString() })
  }, true)
}

/** 与某人的会话(双向) */
export function dmThread(data: CommunityData, meId: string, otherId: string): import('../types').DirectMessage[] {
  return data.messages
    .filter((m) => (m.from === meId && m.to === otherId) || (m.from === otherId && m.to === meId))
    .sort((x, y) => x.at.localeCompare(y.at))
}

export function markDmRead(data: CommunityData, meId: string, otherId: string): void {
  let changed = false
  for (const m of data.messages) {
    if (m.from === otherId && m.to === meId && !m.read) {
      m.read = true
      changed = true
    }
  }
  if (changed) flush(data)
}

export function unreadDmCount(data: CommunityData, meId: string): number {
  return data.messages.filter((m) => m.to === meId && !m.read).length
}

// ---------- 会议邀请(站内) ----------

export function createInvite(invite: Omit<MeetingInvite, 'id' | 'at' | 'status'>): void {
  mutate((d) => {
    if (d.invites.some((i) => i.meetingId === invite.meetingId && i.to === invite.to && i.status === 'pending')) return
    d.invites.unshift({ ...invite, id: uid('inv'), at: new Date().toISOString(), status: 'pending' })
  }, true)
}

export function respondInvite(inviteId: string, accept: boolean): void {
  mutate((d) => {
    const inv = d.invites.find((i) => i.id === inviteId)
    if (inv) inv.status = accept ? 'accepted' : 'declined'
  }, true)
}

// ---------- 搜索 / 筛选 / 排序(纯函数,可测试) ----------

export interface PostQuery {
  text?: string
  subject?: string
  tag?: string
  status?: PostStatus | 'all'
  sort?: 'latest' | 'hot' | 'bounty' | 'unresolved'
  bookmarksOf?: string
}

export function queryPosts(data: CommunityData, q: PostQuery): CommunityPost[] {
  let list = [...data.posts]
  const text = q.text?.trim().toLowerCase()
  if (text) {
    list = list.filter(
      (p) => p.title.toLowerCase().includes(text) || p.body.toLowerCase().includes(text) || p.tags.some((t) => t.toLowerCase().includes(text))
    )
  }
  if (q.subject && q.subject !== 'all') list = list.filter((p) => p.subject === q.subject)
  if (q.tag && q.tag !== 'all') list = list.filter((p) => p.tags.includes(q.tag!))
  if (q.status && q.status !== 'all') list = list.filter((p) => p.status === q.status)
  if (q.bookmarksOf) list = list.filter((p) => p.bookmarks.includes(q.bookmarksOf!))
  switch (q.sort) {
    case 'hot':
      list.sort((a, b) => hotScore(b) - hotScore(a))
      break
    case 'bounty':
      list.sort((a, b) => b.bounty - a.bounty || b.createdAt.localeCompare(a.createdAt))
      break
    case 'unresolved':
      list = list.filter((p) => p.status !== 'solved').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
    default:
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return list
}

export function hotScore(p: CommunityPost): number {
  const ageHours = Math.max(1, (Date.now() - new Date(p.createdAt).getTime()) / 3600000)
  return (p.likes * 3 + p.views * 0.2 + (p.bounty > 0 ? 5 : 0) + p.reports.length * -10) / Math.pow(ageHours + 2, 0.4)
}

export function commentsOf(data: CommunityData, postId: string): CommunityComment[] {
  return data.comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** 评论区树:顶层 + 楼中楼 */
export function commentTree(data: CommunityData, postId: string): { comment: CommunityComment; children: CommunityComment[] }[] {
  const all = commentsOf(data, postId)
  return all
    .filter((c) => !c.parentId)
    .map((c) => ({ comment: c, children: all.filter((x) => x.parentId === c.id) }))
}

export function displayName(p: { author: CommunityUser; anonymous: boolean }): string {
  return p.anonymous ? '匿名同学' : p.author.name
}

// ---------- 示例数据(首次打开社区时播种,让页面不空) ----------

function seedCommunity(): CommunityData {
  const now = Date.now()
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString()
  const kai: CommunityUser = { id: 'seed_kai', name: '学长小凯', avatar: 'cat' }
  const shuxue: CommunityUser = { id: 'seed_shuxue', name: '数学课代表', avatar: 'sprout' }
  const yingyu: CommunityUser = { id: 'seed_yingyu', name: '英语小将', avatar: 'rabbit' }
  const data = emptyCommunity()
  data.seeded = true
  data.credits = { [kai.id]: 180, [shuxue.id]: 260, [yingyu.id]: 120 }
  const p1: CommunityPost = {
    id: 'q_seed_1',
    author: shuxue,
    anonymous: false,
    title: '求极限 lim(x→0) (e^x − 1 − x) / x² 的详细思路',
    body: '泰勒展开到几阶合适?我展开到一阶就做不下去了,求详细步骤和易错点。',
    subject: '高等数学Ⅰ',
    kpName: '极限与连续',
    tags: ['极限', '泰勒展开', '高数Ⅰ'],
    images: [],
    attachments: [],
    bounty: 20,
    status: 'solved',
    createdAt: iso(3 * 24 * 60),
    firstAnswerAt: iso(3 * 24 * 60 - 95),
    solvedAt: iso(3 * 24 * 60 - 90),
    views: 156,
    likes: 23,
    likedBy: [yingyu.id, kai.id],
    bookmarks: [yingyu.id],
    reports: [],
    bestCommentId: 'c_seed_1',
  }
  const p2: CommunityPost = {
    id: 'q_seed_2',
    author: yingyu,
    anonymous: false,
    title: '山东专升本英语作文有没有万能模板?图表类怎么写?',
    body: '距离考试还有几个月,作文想先背模板再练替换,求图表作文的开头/中间/结尾句型。',
    subject: '英语',
    kpName: '写作',
    tags: ['作文模板', '英语'],
    images: [],
    attachments: [],
    bounty: 0,
    status: 'answered',
    createdAt: iso(26 * 60),
    firstAnswerAt: iso(20 * 60),
    views: 87,
    likes: 9,
    likedBy: [],
    bookmarks: [],
    reports: [],
  }
  const p3: CommunityPost = {
    id: 'q_seed_3',
    author: kai,
    anonymous: false,
    title: 'Excel 里 RANK 函数下拉后排名全变了,绝对引用怎么加?',
    body: '=RANK(C2,$C$2:$C$16,0) 我写成 C2:C16 就错,绝对引用的 $ 到底加在哪?',
    subject: '计算机基础',
    kpName: 'Excel 公式与函数',
    tags: ['Excel', 'RANK', '绝对引用', '实操'],
    images: [],
    attachments: [],
    bounty: 10,
    status: 'open',
    createdAt: iso(90),
    views: 12,
    likes: 2,
    likedBy: [],
    bookmarks: [],
    reports: [],
  }
  const p4: CommunityPost = {
    id: 'q_seed_4',
    author: { id: 'seed_anon', name: '匿名', avatar: 'bear' },
    anonymous: true,
    title: '计算机笔试的操作题(Word 替换/格式刷)总丢分,怎么系统复习?',
    body: '15 道操作题每次都对不完,求复习优先级和易错点清单。',
    subject: '计算机基础',
    kpName: 'Office 操作',
    tags: ['Word', '实操', '复习方法'],
    images: [],
    attachments: [],
    bounty: 0,
    status: 'solved',
    createdAt: iso(6 * 24 * 60),
    firstAnswerAt: iso(6 * 24 * 60 - 40),
    solvedAt: iso(6 * 24 * 60 - 35),
    views: 203,
    likes: 31,
    likedBy: [shuxue.id],
    bookmarks: [kai.id, shuxue.id],
    reports: [],
    bestCommentId: 'c_seed_2',
  }
  data.posts = [p3, p2, p1, p4]
  data.comments = [
    {
      id: 'c_seed_1',
      postId: p1.id,
      author: kai,
      anonymous: false,
      body: '展开到二阶:e^x = 1 + x + x²/2 + o(x²),分子剩下 x²/2 + o(x²),除以 x² 得 1/2。\n易错点:展开阶数不够(一阶)会得到 0,这是这类题最常见的坑。',
      createdAt: iso(3 * 24 * 60 - 95),
      likes: 18,
      likedBy: [shuxue.id, yingyu.id],
      best: true,
    },
    {
      id: 'c_seed_1b',
      postId: p1.id,
      parentId: 'c_seed_1',
      author: shuxue,
      anonymous: false,
      body: '谢谢!那洛必达行不行?',
      createdAt: iso(3 * 24 * 60 - 93),
      likes: 2,
      likedBy: [],
    },
    {
      id: 'c_seed_1c',
      postId: p1.id,
      parentId: 'c_seed_1',
      author: kai,
      anonymous: false,
      body: '可以,但求两次导后要检查条件,不如泰勒展开一次到位。',
      createdAt: iso(3 * 24 * 60 - 92),
      likes: 6,
      likedBy: [shuxue.id],
    },
    {
      id: 'c_seed_2',
      postId: p4.id,
      author: shuxue,
      anonymous: false,
      body: '优先级:替换/查找 > 页边距与格式刷 > 段落设置 > 日期域 > 图表。每类动手做 3 遍,错过的记到错题本反复刷。',
      createdAt: iso(6 * 24 * 60 - 40),
      likes: 15,
      likedBy: [kai.id],
      best: true,
    },
    {
      id: 'c_seed_2b',
      postId: p2.id,
      author: kai,
      anonymous: false,
      body: '图表作文开头:The chart illustrates that…;中间段先总后分,结尾 The trend is expected to…。模板要自己改写 20 词以上,防雷同。',
      createdAt: iso(20 * 60),
      likes: 7,
      likedBy: [yingyu.id],
    },
  ]
  // 一条已完成的解答约定(展示历史与双向评价)
  const t1: TutoringSession = {
    id: 't_seed_1',
    postId: p1.id,
    tutor: kai,
    student: shuxue,
    status: 'finished',
    proposedStart: iso(3 * 24 * 60 - 60),
    proposedEnd: iso(3 * 24 * 60 - 120),
    actualStart: iso(3 * 24 * 60 - 122),
    actualEnd: iso(3 * 24 * 60 - 65),
    note: '线上讲泰勒展开阶数选择',
    history: [
      { at: iso(3 * 24 * 60 - 65), by: kai.id, text: '解答结束,等待双方评价' },
      { at: iso(3 * 24 * 60 - 122), by: kai.id, text: '解答开始' },
      { at: iso(3 * 24 * 60 - 130), by: shuxue.id, text: '提问者接受了申请' },
      { at: iso(3 * 24 * 60 - 140), by: kai.id, text: '申请了解答时间' },
    ],
    rating: { studentStars: 5, tutorStars: 5, studentComment: '讲得很清楚,易错点直接点透!', ratedAt: iso(3 * 24 * 60 - 60) },
    createdAt: iso(3 * 24 * 60 - 140),
  }
  data.tutoring = [t1]
  data.friends = [{ id: 'f_seed_1', a: kai.id, b: shuxue.id, since: iso(10 * 24 * 60) }]
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
  return data
}

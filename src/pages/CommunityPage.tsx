// 问题社区:发帖/搜索筛选排序/详情/评论楼中楼/点赞收藏举报/最佳答案/解答时间/好友私信/发起会议
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CommunityComment, CommunityData, CommunityPost, CommunityUser, PostStatus, TutoringSession } from '../types'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { EmptyState, Field, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { AVATAR_INFO } from '../lib/theme'
import { getSession, listUsers } from '../lib/auth'
import { findCloudUsers } from '../services/cloud'
import { downloadBlob, uid } from '../lib/misc'
import { processSkinImage } from '../lib/colorExtract'
import { listMeetings } from '../services/rtc'
import { FeatureTour, filterExistingSteps } from '../components/FeatureTour'
import type { TourStep } from '../components/FeatureTour'
import { cloudAddFriend, cloudRespondFriendRequest, cloudSendDm, cloudSendInvite, subscribeCommunityCloud } from '../services/communityCloud'
import { startMeetingForPost } from './MeetingPage'
import {
  addComment, addFriend, applyForTutoring, commentTree, createPost, deletePost, dmThread, getCredits, isFriend, loadCommunity,
  markBestAnswer, markDmRead, openPost, pendingFriendRequests, queryPosts, rateTutoring, reportPost, respondFriendRequest, sendDm, solveDuration, subscribeCommunity,
  toggleBookmark, toggleCommentLike, togglePostLike, tutoringAction,
} from '../services/community'
import type { PostQuery } from '../services/community'

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_META: Record<PostStatus, { text: string; tone: 'gray' | 'blue' | 'green' }> = {
  open: { text: '待回答', tone: 'gray' },
  answered: { text: '待采纳', tone: 'blue' },
  solved: { text: '已解决', tone: 'green' },
}

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span className="stars" role={onChange ? 'radiogroup' : undefined} aria-label={`评分 ${value} 星`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star-btn${n <= value ? ' on' : ''}`}
          aria-label={`${n} 星`}
          disabled={!onChange}
          onClick={() => onChange?.(n)}
        >
          <Icon name="star" size={16} />
        </button>
      ))}
    </span>
  )
}

// ---------- 入口 ----------

export function CommunityPage({ me }: { me: CommunityUser }) {
  const [sub, setSub] = useState<string | null>(() => {
    const raw = window.location.hash.replace(/^#\//, '')
    const part = raw.split('?')[0].split('/')[1]
    return part || null
  })

  useEffect(() => {
    const h = () => {
      const raw = window.location.hash.replace(/^#\//, '')
      const part = raw.split('?')[0].split('/')[1]
      setSub(part || null)
    }
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  // 云端频道:跨设备好友/邀请/私信(配置了 Supabase 环境变量时启用)
  useEffect(() => subscribeCommunityCloud(me.id), [me.id])

  return sub ? <PostDetail postId={sub} me={me} /> : <CommunityList me={me} />
}

// ---------- 列表 ----------

function CommunityList({ me }: { me: CommunityUser }) {
  const toast = useToast()
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState<PostQuery>({ sort: 'latest', status: 'all' })
  const [askOpen, setAskOpen] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('friends') === '1')
  useEffect(() => subscribeCommunity(() => setTick((t) => t + 1)), [])
  const data = useMemo(() => loadCommunity(), [tick])
  const posts = queryPosts(data, query)
  const tags = [...new Set(data.posts.flatMap((p) => p.tags))].slice(0, 20)
  const subjects = [...new Set(data.posts.map((p) => p.subject))]
  const myCredits = getCredits(data, me.id)
  const unread = data.messages.filter((m) => m.to === me.id && !m.read).length

  // 每次进入都显示新手引导(可随时点"跳过教程(已学会)")
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setTourOpen(true), 500)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="page community">
      {tourOpen && (
        <FeatureTour
          steps={filterExistingSteps(COMMUNITY_LIST_TOUR)}
          onClose={() => setTourOpen(false)}
        />
      )}
      <section className="card">
        <div className="card-h">
          <b>问题社区</b>
          <span className="chip chip-yellow num" data-tour="credits" title="悬赏积分:发布悬赏会扣除,被采纳后获得">
            <Icon name="star" size={12} /> 我的积分 {myCredits}
          </span>
          <button className="btn btn-sm" data-tour="friends" onClick={() => setFriendsOpen(true)}>
            <Icon name="users" size={14} /> 好友/私信{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button className="btn btn-sm btn-primary" data-tour="ask" onClick={() => setAskOpen(true)}>
            <Icon name="plus" size={14} /> 提问
          </button>
        </div>
        <p className="page-hint">
          💡 三步用起来:点右上角<b>「提问」</b>发布问题(可配图+悬赏)→ 等别人回答后<b>采纳最佳答案</b>赚积分 →
          不会的题点进详情<b>「发起会议讲题」</b>开白板一对一问。
        </p>

        <div className="community-toolbar" data-tour="filters">
          <div className="searchbox">
            <Icon name="search" size={15} />
            <input
              placeholder="搜索问题标题、内容、标签…"
              value={query.text ?? ''}
              onChange={(e) => setQuery({ ...query, text: e.target.value })}
              aria-label="搜索问题"
            />
          </div>
          <select value={query.subject ?? 'all'} onChange={(e) => setQuery({ ...query, subject: e.target.value })} aria-label="按学科筛选">
            <option value="all">全部学科</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={query.tag ?? 'all'} onChange={(e) => setQuery({ ...query, tag: e.target.value })} aria-label="按标签筛选">
            <option value="all">全部标签</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          <Segmented
            small
            value={query.sort ?? 'latest'}
            onChange={(v) => setQuery({ ...query, sort: v })}
            options={[
              { value: 'latest', label: '最新' },
              { value: 'hot', label: '热门' },
              { value: 'bounty', label: '悬赏' },
              { value: 'unresolved', label: '未解决' },
            ]}
          />
          <Segmented
            small
            value={query.status ?? 'all'}
            onChange={(v) => setQuery({ ...query, status: v })}
            options={[
              { value: 'all', label: '全部' },
              { value: 'open', label: '待回答' },
              { value: 'answered', label: '待采纳' },
              { value: 'solved', label: '已解决' },
            ]}
          />
          <label className="check-row slim">
            <input type="checkbox" checked={!!query.bookmarksOf} onChange={(e) => setQuery({ ...query, bookmarksOf: e.target.checked ? me.id : undefined })} />
            只看收藏
          </label>
        </div>

        {posts.length === 0 ? (
          <EmptyState mood="think" title="没有符合条件的问题" desc="换个筛选条件,或者点击「提问」发起第一个问题。" action={<button className="btn btn-primary" onClick={() => setAskOpen(true)}>我要提问</button>} />
        ) : (
          <ul className="post-list" data-tour="posts">
            {posts.map((p) => (
              <li key={p.id}>
                <a className="post-card" href={`#/community/${p.id}`}>
                  <div className="post-card-main">
                    <div className="post-card-title">
                      <span className={`chip chip-${STATUS_META[p.status].tone}`}>{STATUS_META[p.status].text}</span>
                      {p.bounty > 0 && (
                        <span className="chip chip-yellow num" title="悬赏积分">
                          <Icon name="star" size={11} /> {p.bounty}
                        </span>
                      )}
                      {p.anonymous && <span className="chip chip-gray">匿名</span>}
                      <b>{p.title}</b>
                    </div>
                    <p className="post-card-body">{p.body}</p>
                    <div className="post-card-meta">
                      <span>{p.anonymous ? '匿名同学' : p.author.name}</span>
                      <span>{p.subject}</span>
                      {p.kpName && <span>{p.kpName}</span>}
                      {p.tags.slice(0, 3).map((t) => (
                        <span key={t} className="tag">
                          #{t}
                        </span>
                      ))}
                      <span className="muted">{fmtAgo(p.createdAt)}</span>
                    </div>
                  </div>
                  <div className="post-card-stats num">
                    <span title="回答数">
                      <Icon name="chat" size={14} /> {data.comments.filter((c) => c.postId === p.id && !c.parentId).length}
                    </span>
                    <span title="点赞">
                      <Icon name="thumb" size={14} /> {p.likes}
                    </span>
                    <span title="浏览">
                      <Icon name="eye" size={14} /> {p.views}
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {askOpen && <AskModal me={me} myCredits={myCredits} onClose={() => setAskOpen(false)} />}
      {friendsOpen && <FriendsModal me={me} data={data} onClose={() => setFriendsOpen(false)} />}
    </div>
  )
}

// ---------- 提问表单 ----------

function AskModal({ me, myCredits, onClose }: { me: CommunityUser; myCredits: number; onClose: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [kpName, setKpName] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ name: string; dataUrl: string; size: number }[]>([])
  const [anonymous, setAnonymous] = useState(false)
  const [bounty, setBounty] = useState(0)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLInputElement>(null)
  const attRef = useRef<HTMLInputElement>(null)

  async function onImages(files: FileList | null) {
    if (!files) return
    setBusy(true)
    try {
      for (const f of Array.from(files).slice(0, 3 - images.length)) {
        const res = await processSkinImage(f)
        setImages((prev) => [...prev, res.dataUrl])
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '图片处理失败', { kind: 'error' })
    } finally {
      setBusy(false)
      if (imgRef.current) imgRef.current.value = ''
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) {
      if (f.size > 2 * 1024 * 1024) {
        toast(`附件「${f.name}」超过 2MB,请压缩后再上传`, { kind: 'error' })
        continue
      }
      if (attachments.length >= 2) {
        toast('附件最多 2 个', { kind: 'error' })
        break
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(f)
      })
      setAttachments((prev) => [...prev, { name: f.name, dataUrl, size: f.size }])
    }
    if (attRef.current) attRef.current.value = ''
  }

  function submit() {
    if (title.trim().length < 5) {
      toast('标题至少 5 个字,方便别人看懂问题', { kind: 'error' })
      return
    }
    if (body.trim().length < 10) {
      toast('问题描述至少 10 个字,写清楚卡在哪一步', { kind: 'error' })
      return
    }
    if (!subject.trim()) {
      toast('请选择或填写学科', { kind: 'error' })
      return
    }
    if (bounty > myCredits) {
      toast('悬赏不能超过你的积分', { kind: 'error' })
      return
    }
    try {
      const created = createPost({
        me,
        title,
        body,
        subject: subject.trim(),
        kpName,
        tags: tagsText
          .split(/[,，\s]+/)
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
          .slice(0, 5),
        images,
        attachments,
        anonymous,
        bounty,
      })
      toast('发布成功!把问题链接发给别人,或在详情页发起讲题会议', {
        kind: 'success',
        action: { label: '查看问题', onClick: () => (window.location.hash = `#/community/${created.id}`) },
      })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '发布失败', { kind: 'error' })
    }
  }

  return (
    <Modal
      open
      title="发布问题"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            <Icon name="send" size={14} /> 发布
          </button>
        </>
      }
    >
      <Field label="标题" hint="至少 5 个字">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="一句话说清问题,例如:泰勒展开到底取几阶?" />
      </Field>
      <Field label="问题描述" hint="至少 10 个字:写清题目、你的思路、卡住的步骤">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} />
      </Field>
      <div className="grid-2">
        <Field label="学科" hint="如:高等数学Ⅰ / 英语 / 计算机基础">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={20} list="community-subjects" />
          <datalist id="community-subjects">
            <option value="高等数学Ⅰ" />
            <option value="高等数学Ⅱ" />
            <option value="高等数学Ⅲ" />
            <option value="英语" />
            <option value="计算机基础" />
            <option value="大学语文" />
            <option value="政治" />
          </datalist>
        </Field>
        <Field label="知识点(选填)">
          <input value={kpName} onChange={(e) => setKpName(e.target.value)} maxLength={30} placeholder="如:极限与连续" />
        </Field>
      </div>
      <Field label="标签" hint="用空格或逗号分隔,最多 5 个">
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="极限 泰勒展开" />
      </Field>
      <Field label="上传题目图片" hint="支持 JPG/PNG/WEBP,单张 ≤5MB,最多 3 张;清晰拍题更易被解答">
        {images.length > 0 && (
          <div className="ask-imgs">
            {images.map((src, i) => (
              <span key={i} className="ask-img">
                <img src={src} alt={`题目图片 ${i + 1}`} />
                <button className="ask-img-del" aria-label={`删除图片 ${i + 1}`} onClick={() => setImages(images.filter((_, j) => j !== i))}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {images.length < 3 && (
          <button className="btn btn-sm" onClick={() => imgRef.current?.click()} disabled={busy}>
            <Icon name="image" size={14} /> {busy ? '处理中…' : '添加图片'}
          </button>
        )}
        <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={(e) => void onImages(e.target.files)} />
      </Field>
      <Field label="附件(选填,最多 2 个,单个 ≤2MB)">
        {attachments.map((a, i) => (
          <span key={i} className="chip chip-gray att-chip">
            <Icon name="download" size={12} /> {a.name}({Math.ceil(a.size / 1024)}KB)
            <button className="att-del" aria-label={`删除附件 ${a.name}`} onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}>
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        <button className="btn btn-sm" onClick={() => attRef.current?.click()}>
          <Icon name="upload" size={14} /> 添加附件
        </button>
        <input ref={attRef} type="file" style={{ display: 'none' }} onChange={(e) => void onFiles(e.target.files)} />
      </Field>
      <Field label={`悬赏积分:${bounty}(当前可用 ${myCredits})`} hint="悬赏在发布时冻结,采纳最佳答案后自动转给回答者">
        <input type="range" min={0} max={Math.max(50, myCredits)} step={5} value={bounty} onChange={(e) => setBounty(Number(e.target.value))} aria-label="悬赏积分" />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        匿名发布(对外显示为「匿名同学」,积分仍归我的账号)
      </label>
    </Modal>
  )
}

// ---------- 详情 ----------

function PostDetail({ postId, me }: { postId: string; me: CommunityUser }) {
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const [tick, setTick] = useState(0)
  const [profileUser, setProfileUser] = useState<CommunityUser | null>(null)
  const [dmTo, setDmTo] = useState<CommunityUser | null>(null)
  const opened = useRef(false)

  useEffect(() => subscribeCommunity(() => setTick((t) => t + 1)), [])
  const data = useMemo(() => loadCommunity(), [tick])
  const post = data.posts.find((p) => p.id === postId)

  useEffect(() => {
    if (post && !opened.current) {
      opened.current = true
      openPost(post.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id])

  if (!post) {
    return (
      <div className="page community">
        <EmptyState mood="think" title="问题不存在或已被删除" action={<a className="btn btn-primary" href="#/community">返回社区</a>} />
      </div>
    )
  }

  const isAsker = post.author.id === me.id
  const friendRequest = (data.friendRequests ?? []).find((item) => item.status === 'pending' && ((item.from.id === me.id && item.to.id === post.author.id) || (item.from.id === post.author.id && item.to.id === me.id)))
  const tree = commentTree(data, postId)
  const tutorings = data.tutoring.filter((t) => t.postId === postId)
  const duration = solveDuration(post)
  const linkedMeetings = listMeetingsFor(post.id)

  async function report() {
    const reason = window.prompt('请填写举报原因(将提交给社区管理):')
    if (!reason?.trim()) return
    reportPost(post!.id, me.id, reason.trim())
    toast('已提交举报,感谢维护社区环境', { kind: 'success' })
  }

  // 每次进入详情页显示引导(可跳过)
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setTourOpen(true), 500)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="page community detail">
      {confirmNode}
      {tourOpen && <FeatureTour steps={filterExistingSteps(COMMUNITY_DETAIL_TOUR)} onClose={() => setTourOpen(false)} />}
      <div className="community-detail-nav">
        <a className="btn btn-sm back" href="#/community">
          <Icon name="left" size={14} /> 返回社区
        </a>
        <a className="btn btn-sm" href="#/community?friends=1">
          <Icon name="users" size={14} /> 好友/私信
        </a>
      </div>

      <section className="card post-detail">
        <div className="post-detail-h">
          <span className={`chip chip-${STATUS_META[post.status].tone}`}>{STATUS_META[post.status].text}</span>
          {post.bounty > 0 && (
            <span className="chip chip-yellow num">
              <Icon name="star" size={11} /> 悬赏 {post.bounty} 积分
            </span>
          )}
          <h2>{post.title}</h2>
        </div>
        <div className="post-author-row">
          <Avatar kind={post.author.avatar} color={AVATAR_INFO[post.author.avatar].color} size={30} />
          <b>{post.anonymous ? '匿名同学' : post.author.name}</b>
          <span className="muted">{fmtDateTime(post.createdAt)} 提问</span>
          <span className="muted num">
            <Icon name="eye" size={13} /> {post.views}
          </span>
          <span className="post-author-ops">
            {!post.anonymous && post.author.id !== me.id && (
              <>
                <button className="btn btn-xs" onClick={() => setProfileUser(post.author)}>
                  <Icon name="user" size={12} /> 主页
                </button>
                <button
                  className="btn btn-xs"
                  disabled={isFriend(data, me.id, post.author.id) || !!friendRequest}
                  onClick={() => {
                    try {
                      const request = addFriend(me, post.author)
                      cloudAddFriend(me, post.author, request.id)
                      toast(`已向「${post.author.name}」发送好友申请,等待对方同意`, { kind: 'success' })
                    } catch (e) {
                      toast(e instanceof Error ? e.message : '操作失败', { kind: 'error' })
                    }
                  }}
                >
                  <Icon name="plus" size={12} /> {isFriend(data, me.id, post.author.id) ? '已是好友' : friendRequest ? (friendRequest.from.id === me.id ? '等待对方同意' : '对方已申请') : '加好友'}
                </button>
                <button className="btn btn-xs" onClick={() => setDmTo(post.author)}>
                  <Icon name="chat" size={12} /> 私信
                </button>
              </>
            )}
            <button
              className="btn btn-xs"
              onClick={() => {
                try {
                  toggleBookmark(post.id, me.id)
                  toast(post.bookmarks.includes(me.id) ? '已取消收藏' : '已收藏', { kind: 'success' })
                } catch {
                  /* ignore */
                }
              }}
            >
              <Icon name="bookmark" size={12} /> {post.bookmarks.includes(me.id) ? '已收藏' : '收藏'}
            </button>
            <button className="btn btn-xs" onClick={() => void report()}>
              <Icon name="flag" size={12} /> 举报
            </button>
            {isAsker && (
              <button
                className="btn btn-xs btn-danger-soft"
                onClick={async () => {
                  const ok = await confirm({ title: '删除问题', desc: '删除后不可恢复;未解决的悬赏会退回你的积分。', danger: true, confirmText: '删除' })
                  if (!ok) return
                  try {
                    deletePost(post.id, me)
                    toast('已删除问题', { kind: 'success' })
                    window.location.hash = '#/community'
                  } catch (e) {
                    toast(e instanceof Error ? e.message : '删除失败', { kind: 'error' })
                  }
                }}
              >
                <Icon name="trash" size={12} /> 删除
              </button>
            )}
          </span>
        </div>

        <div className="post-body">{post.body}</div>
        {post.images.length > 0 && (
          <div className="post-imgs">
            {post.images.map((src, i) => (
              <img key={i} src={src} alt={`题目图片 ${i + 1}`} loading="lazy" />
            ))}
          </div>
        )}
        {post.attachments.length > 0 && (
          <div className="post-atts">
            {post.attachments.map((a, i) => (
              <button
                key={i}
                className="chip chip-gray att-chip"
                onClick={() => {
                  const [meta, b64] = a.dataUrl.split(',')
                  const mime = meta.match(/data:(.*);base64/)?.[1] ?? 'application/octet-stream'
                  const bin = atob(b64)
                  const arr = new Uint8Array(bin.length)
                  for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j)
                  downloadBlob(a.name, new Blob([arr], { type: mime }))
                }}
              >
                <Icon name="download" size={12} /> {a.name}({Math.ceil(a.size / 1024)}KB)
              </button>
            ))}
          </div>
        )}

        <div className="post-timeline num" data-tour="timeline">
          <span>
            <Icon name="timer" size={13} /> 提问 {fmtDateTime(post.createdAt)}
          </span>
          {post.firstAnswerAt && (
            <span>
              <Icon name="chat" size={13} /> 首次解答 {fmtDateTime(post.firstAnswerAt)}
            </span>
          )}
          {post.solvedAt && (
            <span>
              <Icon name="check" size={13} /> 完成 {fmtDateTime(post.solvedAt)}
            </span>
          )}
          {duration && <span className="chip chip-green">解决耗时 {duration}</span>}
        </div>

        <div className="post-foot-ops" data-tour="footops">
          <button
            className={`btn btn-sm${post.likedBy.includes(me.id) ? ' btn-primary' : ''}`}
            onClick={() => togglePostLike(post.id, me.id)}
            aria-pressed={post.likedBy.includes(me.id)}
          >
            <Icon name="thumb" size={14} /> 点赞 {post.likes}
          </button>
          {linkedMeetings.length > 0 ? (
            <a className="btn btn-sm" href={`#/meeting/${linkedMeetings[0].id}`}>
              <Icon name="video" size={14} /> 进入会议({linkedMeetings[0].title})
            </a>
          ) : (
            !post.anonymous && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  // 我发起会议:若我是提问者则邀请最新回答者,否则邀请提问者
                  const answerers = data.comments.filter((c) => c.postId === post.id && !c.anonymous && c.author.id !== me.id)
                  const invitee = isAsker ? answerers[answerers.length - 1]?.author : post.author
                  if (!invitee) {
                    toast('还没有可邀请的人:等第一个回答出现,或把会议链接复制给对方', { kind: 'info' })
                    return
                  }
                  const m = startMeetingForPost(me, post.id, invitee)
                  toast(`会议已创建,已向「${invitee.name}」发送站内邀请;也可复制会议链接`, { kind: 'success' })
                  window.location.hash = `#/meeting/${m.id}`
                }}
              >
                <Icon name="video" size={14} /> 发起会议讲题
              </button>
            )
          )}
        </div>
      </section>

      {/* 解答时间 */}
      <TutoringPanel post={post} me={me} tutorings={tutorings} />

      {/* 评论区 */}
      <section className="card" data-tour="comments">
        <div className="card-h">
          <b>回答与讨论({data.comments.filter((c) => c.postId === post.id).length})</b>
        </div>
        {tree.length === 0 && <p className="muted">还没有回答,抢个沙发~</p>}
        <ul className="comment-list">
          {tree.map(({ comment, children }) => (
            <CommentNode key={comment.id} comment={comment} children_={children} post={post} data={data} me={me} setProfileUser={setProfileUser} setDmTo={setDmTo} isAsker={isAsker} />
          ))}
        </ul>
        <CommentForm postId={post.id} me={me} onDone={() => setTick((t) => t + 1)} />
      </section>

      {profileUser && <PublicProfileModal user={profileUser} data={data} me={me} onClose={() => setProfileUser(null)} onDm={(u) => { setProfileUser(null); setDmTo(u) }} />}
      {dmTo && <DmModal me={me} other={dmTo} data={data} onClose={() => setDmTo(null)} />}
    </div>
  )
}

function listMeetingsFor(postId: string): import('../types').MeetingInfo[] {
  return listMeetings().filter((m) => m.postId === postId)
}

// ---------- 解答时间面板 ----------

function TutoringPanel({ post, me, tutorings }: { post: CommunityPost; me: CommunityUser; tutorings: TutoringSession[] }) {
  const toast = useToast()
  const isAsker = post.author.id === me.id
  const mine = tutorings.find((t) => t.tutor.id === me.id && ['pending', 'accepted', 'active'].includes(t.status))
  const [start, setStart] = useState(() => new Date(Date.now() + 30 * 60000).toISOString().slice(0, 16))
  const [end, setEnd] = useState(() => new Date(Date.now() + 90 * 60000).toISOString().slice(0, 16))
  const [note, setNote] = useState('')
  const [rateSession, setRateSession] = useState<TutoringSession | null>(null)

  const finished = tutorings.filter((t) => t.status === 'finished')

  return (
    <section className="card" data-tour="tutor">
      <div className="card-h">
        <b>解答时间</b>
        <span className="muted">申请一对一解答 → 提问者接受 → 按约定时间开始/结束 → 双方互评</span>
      </div>

      {!isAsker && !mine && post.status !== 'solved' && (
        <div className="tutor-apply">
          <div className="grid-3">
            <Field label="约定开始">
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="预计结束">
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="说明(选填)">
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="如:线上讲泰勒展开" />
            </Field>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              try {
                applyForTutoring(post.id, me, new Date(start).toISOString(), new Date(end).toISOString(), note)
                toast('已提交解答申请,等提问者确认', { kind: 'success' })
                setNote('')
              } catch (e) {
                toast(e instanceof Error ? e.message : '申请失败', { kind: 'error' })
              }
            }}
          >
            <Icon name="timer" size={14} /> 申请解答
          </button>
        </div>
      )}
      {!isAsker && mine && <p className="muted">你已申请解答该问题,当前状态:{STATUS_TEXT_TUTOR[mine.status]}</p>}

      {tutorings.length === 0 && isAsker && <p className="muted">还没有人申请解答。有人申请后,你可以在这里接受/拒绝并约定时间。</p>}

      <ul className="tutor-list">
        {tutorings.map((t) => {
          const amStudent = t.student.id === me.id
          const amTutor = t.tutor.id === me.id
          return (
            <li key={t.id} className={`tutor-item status-${t.status}`}>
              <div className="tutor-item-h">
                <Avatar kind={t.tutor.avatar} color={AVATAR_INFO[t.tutor.avatar].color} size={24} />
                <b>{t.tutor.name}</b>
                <span className={`chip chip-${mapTutorTone(t.status)}`}>{STATUS_TEXT_TUTOR[t.status]}</span>
                <span className="muted num">
                  约定:{fmtDateTime(t.proposedStart)} ~ {fmtDateTime(t.proposedEnd)}
                </span>
                {(amStudent || amTutor) && ['pending', 'accepted', 'active'].includes(t.status) && (
                  <span className="tutor-item-ops">
                    {amStudent && t.status === 'pending' && (
                      <>
                        <button className="btn btn-xs btn-primary" onClick={() => { tutoringAction({ kind: 'accept', sessionId: t.id, by: me }); toast('已接受,请按约定时间开始', { kind: 'success' }) }}>
                          接受
                        </button>
                        <button className="btn btn-xs" onClick={() => { tutoringAction({ kind: 'reject', sessionId: t.id, by: me }); toast('已拒绝') }}>
                          拒绝
                        </button>
                      </>
                    )}
                    {amTutor && t.status === 'accepted' && (
                      <button className="btn btn-xs btn-primary" onClick={() => { tutoringAction({ kind: 'start', sessionId: t.id, by: me }); toast('解答开始,记得开会议讲题', { kind: 'success' }) }}>
                        开始解答
                      </button>
                    )}
                    {amTutor && t.status === 'active' && (
                      <button className="btn btn-xs btn-primary" onClick={() => { tutoringAction({ kind: 'finish', sessionId: t.id, by: me }); toast('解答已结束,别忘了互相评价', { kind: 'success' }) }}>
                        结束解答
                      </button>
                    )}
                    {(amStudent || amTutor) && (
                      <button
                        className="btn btn-xs btn-danger-soft"
                        onClick={() => { tutoringAction({ kind: 'cancel', sessionId: t.id, by: me }); toast('已取消解答约定') }}
                      >
                        取消
                      </button>
                    )}
                  </span>
                )}
              </div>
              {t.note && <p className="tutor-note">{t.note}</p>}
              {(t.actualStart || t.actualEnd) && (
                <p className="muted num">
                  实际:{t.actualStart ? fmtDateTime(t.actualStart) : '—'} ~ {t.actualEnd ? fmtDateTime(t.actualEnd) : '进行中'}
                </p>
              )}
              <details className="tutor-history">
                <summary>进度与历史({t.history.length})</summary>
                <ul>
                  {t.history.map((h, i) => (
                    <li key={i} className="num">
                      {fmtDateTime(h.at)} · {h.by === t.tutor.id ? t.tutor.name : t.student.name}:{h.text}
                    </li>
                  ))}
                </ul>
              </details>
              {t.status === 'finished' && (amStudent || amTutor) && (
                <div className="tutor-rate">
                  {t.rating?.studentStars && amStudent ? (
                    <span>
                      我的评价:<Stars value={t.rating.studentStars} /> {t.rating.studentComment}
                    </span>
                  ) : t.rating?.tutorStars && amTutor ? (
                    <span>
                      我的评价:<Stars value={t.rating.tutorStars} /> {t.rating.tutorComment}
                    </span>
                  ) : (
                    <button className="btn btn-xs btn-primary" onClick={() => setRateSession(t)}>
                      <Icon name="star" size={12} /> 评价这次解答
                    </button>
                  )}
                  {amStudent && t.rating?.tutorStars ? <span className="muted">对方评我:{t.rating.tutorStars} 星</span> : null}
                  {amTutor && t.rating?.studentStars ? <span className="muted">对方评我:{t.rating.studentStars} 星</span> : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {finished.length > 0 && (
        <p className="muted" style={{ marginTop: 6 }}>
          历史解答 {finished.length} 次;完成率 {Math.round((finished.length / tutorings.length) * 100)}%
        </p>
      )}

      {rateSession && <RateModal session={rateSession} me={me} onClose={() => setRateSession(null)} />}
    </section>
  )
}

const STATUS_TEXT_TUTOR: Record<TutoringSession['status'], string> = {
  pending: '待确认',
  accepted: '已接受',
  rejected: '已拒绝',
  active: '解答中',
  finished: '已完成',
  cancelled: '已取消',
}

function mapTutorTone(s: TutoringSession['status']): string {
  return s === 'finished' ? 'green' : s === 'active' ? 'blue' : s === 'rejected' || s === 'cancelled' ? 'gray' : 'yellow'
}

function RateModal({ session, me, onClose }: { session: TutoringSession; me: CommunityUser; onClose: () => void }) {
  const toast = useToast()
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const amStudent = session.student.id === me.id
  return (
    <Modal
      open
      title="评价这次解答"
      onClose={onClose}
      width={380}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              try {
                rateTutoring(session.id, me, stars, comment)
                toast('评价已提交', { kind: 'success' })
                onClose()
              } catch (e) {
                toast(e instanceof Error ? e.message : '评价失败', { kind: 'error' })
              }
            }}
          >
            提交评价
          </button>
        </>
      }
    >
      <Field label="评分">
        <Stars value={stars} onChange={setStars} />
      </Field>
      <Field label="评语(选填)">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={200} placeholder={amStudent ? '讲得怎么样?' : '和这位同学交流如何?'} />
      </Field>
    </Modal>
  )
}

// ---------- 评论 ----------

function CommentNode({
  comment,
  children_,
  post,
  data,
  me,
  setProfileUser,
  setDmTo,
  isAsker,
  parentId,
}: {
  comment: CommunityComment
  children_?: CommunityComment[]
  post: CommunityPost
  data: CommunityData
  me: CommunityUser
  setProfileUser: (u: CommunityUser) => void
  setDmTo: (u: CommunityUser) => void
  isAsker: boolean
  parentId?: string
}) {
  const toast = useToast()
  const [replyOpen, setReplyOpen] = useState(false)
  const mine = comment.author.id === me.id

  return (
    <li className={`comment${comment.best ? ' best' : ''}`}>
      <div className="comment-h">
        <Avatar kind={comment.author.avatar} color={AVATAR_INFO[comment.author.avatar].color} size={26} />
        <b>{comment.anonymous ? '匿名同学' : comment.author.name}</b>
        {comment.best && <span className="chip chip-green">最佳答案</span>}
        <span className="muted">{fmtAgo(comment.createdAt)}</span>
      </div>
      <div className="comment-body">{comment.body}</div>
      <div className="comment-ops">
        <button className={`btn btn-xs${comment.likedBy.includes(me.id) ? ' btn-primary' : ''}`} onClick={() => toggleCommentLike(comment.id, me.id)} aria-pressed={comment.likedBy.includes(me.id)}>
          <Icon name="thumb" size={12} /> {comment.likes}
        </button>
        {!parentId && (
          <button className="btn btn-xs" onClick={() => setReplyOpen((v) => !v)}>
            回复
          </button>
        )}
        {!comment.anonymous && !mine && (
          <>
            <button className="btn btn-xs" onClick={() => setProfileUser(comment.author)}>
              主页
            </button>
            <button className="btn btn-xs" onClick={() => setDmTo(comment.author)}>
              私信
            </button>
          </>
        )}
        {isAsker && !post.bestCommentId && (
          <button
            className="btn btn-xs btn-primary"
            onClick={() => {
              try {
                markBestAnswer(post.id, comment.id, me)
                toast(post.bounty > 0 ? `已采纳为最佳答案,${post.bounty} 积分已转给回答者` : '已采纳为最佳答案', { kind: 'success' })
              } catch (e) {
                toast(e instanceof Error ? e.message : '操作失败', { kind: 'error' })
              }
            }}
          >
            <Icon name="check" size={12} /> 采纳为最佳答案
          </button>
        )}
      </div>
      {replyOpen && <CommentForm postId={post.id} me={me} parentId={comment.id} compact onDone={() => setReplyOpen(false)} />}
      {children_ && children_.length > 0 && (
        <ul className="comment-children">
          {children_.map((c) => (
            <CommentNode key={c.id} comment={c} post={post} data={data} me={me} setProfileUser={setProfileUser} setDmTo={setDmTo} isAsker={isAsker} parentId={comment.id} />
          ))}
        </ul>
      )}
    </li>
  )
}

function CommentForm({ postId, me, parentId, compact, onDone }: { postId: string; me: CommunityUser; parentId?: string; compact?: boolean; onDone?: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  return (
    <form
      className={`comment-form${compact ? ' compact' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim().length < 2) {
          toast('内容太短了', { kind: 'error' })
          return
        }
        try {
          addComment(postId, me, text, anonymous, parentId)
          setText('')
          toast('已发布', { kind: 'success' })
          onDone?.()
        } catch (err) {
          toast(err instanceof Error ? err.message : '发布失败', { kind: 'error' })
        }
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={1000}
        placeholder={parentId ? '回复这条评论…' : '写下你的回答或思路(支持换行)…'}
        aria-label={parentId ? '回复内容' : '回答内容'}
      />
      <div className="comment-form-ops">
        <label className="check-row slim">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          匿名
        </label>
        <button className="btn btn-sm btn-primary" type="submit">
          <Icon name="send" size={13} /> {parentId ? '回复' : '发布回答'}
        </button>
      </div>
    </form>
  )
}

// ---------- 公开资料 ----------

function PublicProfileModal({ user, data, me, onClose, onDm }: { user: CommunityUser; data: CommunityData; me: CommunityUser; onClose: () => void; onDm: (u: CommunityUser) => void }) {
  const posts = data.posts.filter((p) => p.author.id === user.id)
  const answers = data.comments.filter((c) => c.author.id === user.id)
  const bestAnswers = answers.filter((c) => c.best)
  const tutorRatings = data.tutoring.filter((t) => t.tutor.id === user.id && t.rating?.studentStars).map((t) => t.rating!.studentStars!)
  const avgStars = tutorRatings.length ? (tutorRatings.reduce((s, x) => s + x, 0) / tutorRatings.length).toFixed(1) : null
  const account = listUsers().find((u) => u.id === user.id)
  const friended = isFriend(data, me.id, user.id)
  const request = (data.friendRequests ?? []).find((item) => item.status === 'pending' && ((item.from.id === me.id && item.to.id === user.id) || (item.from.id === user.id && item.to.id === me.id)))
  const waiting = request?.from.id === me.id

  return (
    <Modal open title="公开资料" onClose={onClose} width={420}>
      <div className="profile-modal">
        <Avatar kind={user.avatar} color={AVATAR_INFO[user.avatar].color} size={56} />
        <b>{user.name}</b>
        <span className="muted">{account ? `加入于 ${new Date(account.createdAt).toLocaleDateString('zh-CN')}${account.vip ? ' · VIP' : ''}` : '社区成员'}</span>
        {avgStars && (
          <span className="chip chip-yellow">
            <Icon name="star" size={12} /> 解答好评 {avgStars}({tutorRatings.length} 次)
          </span>
        )}
        <div className="profile-stats num">
          <span>
            <b>{posts.length}</b> 提问
          </span>
          <span>
            <b>{answers.length}</b> 回答
          </span>
          <span>
            <b>{bestAnswers.length}</b> 被采纳
          </span>
          <span>
            <b>{getCredits(data, user.id)}</b> 积分
          </span>
        </div>
        {user.id !== me.id && (
          <div className="modal-actions">
            <button
              className="btn"
              disabled={friended || !!request}
              onClick={() => {
                try {
                  const next = addFriend(me, user)
                  cloudAddFriend(me, user, next.id)
                  alert('好友申请已发送,等待对方同意')
                } catch (e) {
                  alert(e instanceof Error ? e.message : '操作失败')
                }
              }}
            >
              {friended ? '已是好友' : request ? (waiting ? '等待对方同意' : '对方已申请') : '添加好友'}
            </button>
            <button className="btn btn-primary" onClick={() => onDm(user)}>
              <Icon name="chat" size={14} /> 发私信
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------- 好友与私信 ----------

function FriendRequestList({ me, data }: { me: CommunityUser; data: CommunityData }) {
  const toast = useToast()
  const requests = pendingFriendRequests(data, me.id)
  const incoming = requests.filter((request) => request.to.id === me.id)
  const outgoing = requests.filter((request) => request.from.id === me.id)

  function respond(requestId: string, accept: boolean) {
    try {
      const updated = respondFriendRequest(me.id, requestId, accept)
      cloudRespondFriendRequest(updated, accept)
      toast(accept ? `已接受「${updated.from.name}」的好友申请` : '已拒绝好友申请', { kind: accept ? 'success' : 'info' })
    } catch (error) {
      toast(error instanceof Error ? error.message : '处理好友申请失败', { kind: 'error' })
    }
  }

  if (requests.length === 0) return null
  return (
    <section className="friend-requests" aria-label="好友申请">
      {incoming.length > 0 && (
        <>
          <b className="muted">收到的好友申请({incoming.length})</b>
          {incoming.map((request) => (
            <div className="friend-row" key={request.id}>
              <Avatar kind={request.from.avatar} color={AVATAR_INFO[request.from.avatar].color} size={26} />
              <span>{request.from.name}</span>
              <button className="btn btn-xs btn-primary" onClick={() => respond(request.id, true)}>接受</button>
              <button className="btn btn-xs" onClick={() => respond(request.id, false)}>拒绝</button>
            </div>
          ))}
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <b className="muted" style={{ marginTop: 8 }}>我发出的申请({outgoing.length})</b>
          {outgoing.map((request) => (
            <div className="friend-row" key={request.id}>
              <Avatar kind={request.to.avatar} color={AVATAR_INFO[request.to.avatar].color} size={26} />
              <span>{request.to.name}</span>
              <span className="muted fs12">等待对方同意</span>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function FriendsModal({ me, data, onClose }: { me: CommunityUser; data: CommunityData; onClose: () => void }) {
  const [dmTo, setDmTo] = useState<CommunityUser | null>(null)
  const [accountName, setAccountName] = useState('')
  const [accountError, setAccountError] = useState('')
  const [cloudMatches, setCloudMatches] = useState<CommunityUser[]>([])
  const [lookupBusy, setLookupBusy] = useState(false)
  const known = new Map<string, CommunityUser>()
  for (const p of data.posts) if (!p.anonymous) known.set(p.author.id, p.author)
  for (const c of data.comments) if (!c.anonymous) known.set(c.author.id, c.author)
  for (const t of data.tutoring) {
    known.set(t.tutor.id, t.tutor)
    known.set(t.student.id, t.student)
  }
  for (const f of data.friends) {
    if (f.aUser) known.set(f.aUser.id, f.aUser)
    if (f.bUser) known.set(f.bUser.id, f.bUser)
  }
  known.delete(me.id)
  const friendIds = data.friends.filter((f) => f.a === me.id || f.b === me.id).map((f) => (f.a === me.id ? f.b : f.a))
  const friends = friendIds.map((id) => known.get(id)).filter(Boolean) as CommunityUser[]
  const localAccounts = listUsers()
    .filter((u) => u.id !== me.id)
    .map((u) => ({ id: u.id, name: u.name, avatar: 'sprout' as const }))
  for (const u of localAccounts) known.set(u.id, u)
  for (const u of cloudMatches) known.set(u.id, u)
  const pendingIds = new Set((data.friendRequests ?? []).filter((request) => request.status === 'pending' && (request.from.id === me.id || request.to.id === me.id)).map((request) => (request.from.id === me.id ? request.to.id : request.from.id)))
  const strangers = [...new Map([...known.values()].map((u) => [u.id, u])).values()].filter((u) => !friendIds.includes(u.id) && !pendingIds.has(u.id))
  const unreadOf = (uid2: string) => data.messages.filter((m) => m.from === uid2 && m.to === me.id && !m.read).length

  async function addByAccount() {
    const value = accountName.trim()
    setAccountError('')
    if (!value) {
      setAccountError('请输入对方注册账号')
      return
    }
    const session = getSession()
    if (!session?.cloudToken || !session.cloudApiUrl) {
      setAccountError('请先登录云端账号，才能查找全部用户')
      return
    }
    setLookupBusy(true)
    const matches = await findCloudUsers({ token: session.cloudToken, apiUrl: session.cloudApiUrl }, value)
    setLookupBusy(false)
    setCloudMatches(matches.map((u) => ({ ...u, avatar: 'sprout' as const })))
    const account = matches[0]
    if (!account) {
      setAccountError('未找到该账号，请确认对方已注册且账号拼写正确')
      return
    }
    const other: CommunityUser = { id: account.id, name: account.name, avatar: 'sprout' }
    try {
      const request = addFriend(me, other)
      cloudAddFriend(me, other, request.id)
      setAccountName('')
      setAccountError('已发送好友申请,等待对方同意')
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : '操作失败')
    }
  }

  return (
    <Modal open title="好友 / 私信" onClose={onClose} width={620}>
      <div className="friends-grid">
        <div className="friends-list">
          <div className="friend-search">
            <label className="muted fs12" htmlFor="friend-account">按帐号添加好友</label>
            <div className="inline-form">
              <input id="friend-account" className="input" value={accountName} maxLength={40} placeholder="输入对方帐号" onChange={(e) => { setAccountName(e.target.value); setAccountError('') }} onKeyDown={(e) => { if (e.key === 'Enter') void addByAccount() }} />
              <button className="btn btn-sm btn-primary" type="button" disabled={lookupBusy} onClick={() => void addByAccount()}>{lookupBusy ? '查找中' : '添加'}</button>
            </div>
            {accountError && <span className="fs12" style={{ color: accountError.startsWith('已发送好友申请') ? 'var(--success)' : 'var(--danger)' }}>{accountError}</span>}
          </div>
          <FriendRequestList me={me} data={data} />
          <b className="muted">好友({friends.length})</b>
          {friends.length === 0 && <p className="muted">还没有好友。在问题/回答的「主页」里可以添加。</p>}
          {friends.map((u) => (
            <button key={u.id} className={`friend-row${dmTo?.id === u.id ? ' on' : ''}`} onClick={() => setDmTo(u)}>
              <Avatar kind={u.avatar} color={AVATAR_INFO[u.avatar].color} size={26} />
              <span>{u.name}</span>
              {unreadOf(u.id) > 0 && <span className="chip chip-red num">{unreadOf(u.id)}</span>}
            </button>
          ))}
          <b className="muted" style={{ marginTop: 10 }}>
            社区成员({strangers.length})
          </b>
          {strangers.slice(0, 12).map((u) => (
            <div key={u.id} className="friend-row">
              <Avatar kind={u.avatar} color={AVATAR_INFO[u.avatar].color} size={26} />
              <span>{u.name}</span>
              <button
                className="btn btn-xs"
                onClick={() => {
                  try {
                    const request = addFriend(me, u)
                    cloudAddFriend(me, u, request.id)
                    alert(`已向「${u.name}」发送好友申请,等待对方同意`)
                  } catch (e) {
                    alert(e instanceof Error ? e.message : '操作失败')
                  }
                }}
              >
                加好友
              </button>
            </div>
          ))}
        </div>
        <div className="dm-pane">
          {dmTo ? (
            <DmPanel me={me} other={dmTo} data={data} />
          ) : (
            <p className="muted" style={{ padding: 30, textAlign: 'center' }}>
              选择左侧好友开始私信
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function DmPanel({ me, other, data }: { me: CommunityUser; other: CommunityUser; data: CommunityData }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeCommunity(() => setTick((t) => t + 1)), [])
  const fresh = useMemo(() => loadCommunity(), [tick])
  const thread = dmThread(data ?? fresh, me.id, other.id)
  useEffect(() => {
    markDmRead(loadCommunity(), me.id, other.id)
  }, [me.id, other.id, thread.length])

  return (
    <div className="dm-panel">
      <b>与 {other.name} 的私信</b>
      <div className="dm-msgs">
        {thread.length === 0 && <p className="muted">还没有消息,打个招呼吧~</p>}
        {thread.map((m) => (
          <div key={m.id} className={`dm-msg${m.from === me.id ? ' mine' : ''}`}>
            <span>{m.body}</span>
            <time className="num muted">{fmtDateTime(m.at)}</time>
          </div>
        ))}
      </div>
      <form
        className="meet-chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          try {
            sendDm(me, other, text)
            cloudSendDm(me, other, text, uid('m'), new Date().toISOString())
            setText('')
          } catch (err) {
            toast(err instanceof Error ? err.message : '发送失败', { kind: 'error' })
          }
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`发消息给 ${other.name}…`} maxLength={500} aria-label="私信内容" />
        <button className="btn btn-icon btn-primary" type="submit" aria-label="发送私信">
          <Icon name="send" size={15} />
        </button>
      </form>
    </div>
  )
}

function DmModal({ me, other, data, onClose }: { me: CommunityUser; other: CommunityUser; data: CommunityData; onClose: () => void }) {
  return (
    <Modal open title={`私信 ${other.name}`} onClose={onClose} width={440}>
      <DmPanel me={me} other={other} data={data} />
    </Modal>
  )
}

const COMMUNITY_LIST_TOUR: TourStep[] = [
  { sel: '[data-tour="ask"]', title: '第一步:发布问题', text: '点「提问」写清题目和你卡住的步骤,可上传题目图片、设置悬赏积分,也支持匿名发布。', prefer: 'bottom' },
  { sel: '[data-tour="filters"]', title: '搜索与筛选', text: '按关键词/学科/标签找问题;"未解决"里全是等待回答的;排序可切最新、热门、悬赏。', prefer: 'bottom' },
  { sel: '[data-tour="credits"]', title: '悬赏积分', text: '提问设悬赏会冻结积分,你的回答被采纳后自动赚积分;每个新账号自带 100 分。', prefer: 'bottom' },
  { sel: '[data-tour="friends"]', title: '好友与私信', text: '添加好友后可跨设备私信交流;收到私信时这里会显示未读数。', prefer: 'left' },
  { sel: '[data-tour="posts"]', title: '问题列表', text: '点卡片看详情。状态含义:待回答(没人答)→待采纳(有答案等提问者选)→已解决。', prefer: 'top' },
]

const COMMUNITY_DETAIL_TOUR: TourStep[] = [
  { sel: '[data-tour="footops"]', title: '一键开白板讲题', text: '点「发起会议讲题」:原题自动带进会议,进入后点"题目贴到白板"即可开讲。', prefer: 'top' },
  { sel: '[data-tour="tutor"]', title: '解答时间(一对一)', text: '点「申请解答」并约定时间 → 提问者接受 → 按时开始/结束 → 双方互评,全过程有记录。', prefer: 'bottom' },
  { sel: '[data-tour="comments"]', title: '回答与讨论', text: '支持楼中楼回复和点赞;提问者可「采纳最佳答案」,悬赏积分自动转给回答者。', prefer: 'bottom' },
  { sel: '[data-tour="timeline"]', title: '进度时间线', text: '提问时间/首次解答/完成时间与解决耗时一目了然。', prefer: 'top' },
]

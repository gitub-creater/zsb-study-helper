// 知识校园:地图视图(第二阶段完整版)+ 列表管理(科目/章节/知识点全量 CRUD + 大纲导入)
import React, { useMemo, useState } from 'react'
import type { Chapter, KnowledgePoint, KPStatus, Subject } from '../types'
import { KP_STATUS_ORDER, KP_STATUS_TEXT } from '../types'
import { useStore, emptyStats } from '../store/store'
import { Bar, Chip, EmptyState, Field, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { KPDetail } from '../components/KPDetail'
import { chapterMastery, chapterKps, getMastery, subjectMastery, subjectAccuracy, subjectInLibrary, subjectInScope } from '../lib/selectors'
import { WisdomTreeSVG, getTreeStage } from '../components/WisdomTree'
import { CampusMapArt } from '../components/CampusMapArt'
import { masteryTone } from '../lib/mastery'
import { startKpPractice } from '../lib/practice'
import { uid, nav } from '../lib/misc'
import { fmtDate } from '../lib/date'

type ModalState =
  | { kind: 'none' }
  | { kind: 'addSubject' }
  | { kind: 'editSubject'; subject: Subject }
  | { kind: 'addChapter'; subjectId: string }
  | { kind: 'editChapter'; chapter: Chapter }
  | { kind: 'addKp'; chapterId: string }
  | { kind: 'editKp'; kp: KnowledgePoint }
  | { kind: 'import'; subjectId: string }

const PALETTE = ['#3E9BFF', '#2FB98B', '#8B72E8', '#F2698C', '#E89B1C', '#5FCB9F', '#7EC8FF', '#E88B5C']

function parseOutline(text: string): { name: string; kps: string[] }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const chapRe = /^(第[0-9一二三四五六七八九十百千]+\s*[章节讲单元部分]|chapter\s*\d+|[一二三四五六七八九十]+、)/i
  const out: { name: string; kps: string[] }[] = []
  let cur: { name: string; kps: string[] } | null = null
  for (const l of lines) {
    if (chapRe.test(l)) {
      cur = { name: l.replace(/[:::\s]+$/, ''), kps: [] }
      out.push(cur)
    } else {
      if (!cur) {
        cur = { name: '未分章内容', kps: [] }
        out.push(cur)
      }
      cur.kps.push(l.replace(/^[-·•*—]+\s*/, '').replace(/^\d+[\.、)]\s*/, ''))
    }
  }
  return out
}


export function MapPage() {
  const { state, dispatch, undo } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()
  const [tab, setTab] = useState<'map' | 'wisdom' | 'list'>('map')
  const [showAll, setShowAll] = useState(false)
  const [detailKpId, setDetailKpId] = useState<string | null>(null)
  const [openSubject, setOpenSubject] = useState<string | null>(null)
  const [openChapter, setOpenChapter] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [form, setForm] = useState({ name: '', color: PALETTE[0], target: 80, status: 'unlearned' as KPStatus, notes: '' })
  const [outlineText, setOutlineText] = useState('')

  const allSubjects = [...state.subjects].sort((a, b) => a.order - b.order)
  const subjects = allSubjects.filter((s) => showAll || subjectInLibrary(state, s))
  const detailKp = detailKpId ? (state.kps.find((k) => k.id === detailKpId) ?? null) : null

  const close = () => setModal({ kind: 'none' })
  const openForm = (f: Partial<typeof form>) => setForm({ name: '', color: PALETTE[0], target: 80, status: 'unlearned', notes: '', ...f })

  const outlineParsed = useMemo(() => (modal.kind === 'import' ? parseOutline(outlineText) : []), [outlineText, modal])

  const saveModal = () => {
    switch (modal.kind) {
      case 'addSubject': {
        if (!form.name.trim()) {
          toast('请填写科目名称', { kind: 'error' })
          return
        }
        dispatch({
          type: 'ADD_SUBJECT',
          subject: { id: uid('s'), name: form.name.trim(), color: form.color, targetScore: form.target, order: state.subjects.length },
        })
        toast('科目已添加', { kind: 'success' })
        close()
        break
      }
      case 'editSubject': {
        dispatch({ type: 'UPDATE_SUBJECT', id: modal.subject.id, patch: { name: form.name.trim() || modal.subject.name, color: form.color, targetScore: form.target } })
        toast('已保存', { kind: 'success' })
        close()
        break
      }
      case 'addChapter': {
        if (!form.name.trim()) {
          toast('请填写章节名称', { kind: 'error' })
          return
        }
        const order = state.chapters.filter((c) => c.subjectId === modal.subjectId).length
        dispatch({ type: 'ADD_CHAPTER', chapter: { id: uid('c'), subjectId: modal.subjectId, name: form.name.trim(), order } })
        toast('章节已添加', { kind: 'success' })
        close()
        break
      }
      case 'editChapter': {
        dispatch({ type: 'UPDATE_CHAPTER', id: modal.chapter.id, patch: { name: form.name.trim() || modal.chapter.name } })
        close()
        break
      }
      case 'addKp': {
        if (!form.name.trim()) {
          toast('请填写知识点名称', { kind: 'error' })
          return
        }
        const chapter = state.chapters.find((c) => c.id === modal.chapterId)!
        const order = state.kps.filter((k) => k.chapterId === modal.chapterId).length
        dispatch({
          type: 'ADD_KP',
          kp: { id: uid('k'), subjectId: chapter.subjectId, chapterId: modal.chapterId, name: form.name.trim(), order, status: form.status, notes: form.notes, stats: emptyStats(), mastery: null },
        })
        toast('知识点已添加', { kind: 'success' })
        close()
        break
      }
      case 'editKp': {
        dispatch({ type: 'UPDATE_KP', id: modal.kp.id, patch: { name: form.name.trim() || modal.kp.name, status: form.status, notes: form.notes } })
        toast('已保存', { kind: 'success' })
        close()
        break
      }
      case 'import': {
        if (outlineParsed.length === 0) {
          toast('没有可导入的内容', { kind: 'error' })
          return
        }
        dispatch({ type: 'IMPORT_OUTLINE', subjectId: modal.subjectId, chapters: outlineParsed })
        toast(`已导入 ${outlineParsed.length} 个章节(重名自动跳过)`, { kind: 'success' })
        setOutlineText('')
        close()
        break
      }
      default:
        break
    }
  }

  return (
    <div>
      <div className="page-h">
        <h2>知识校园</h2>
        <div className="spacer" />
        <button className="btn" onClick={() => { openForm({}); setModal({ kind: 'addSubject' }) }}>
          <Icon name="plus" size={14} /> 新增科目
        </button>
      </div>

      <div className="mb12 row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'map', label: '校园地图' },
            { value: 'wisdom', label: '智慧园' },
            { value: 'list', label: '列表管理' },
          ]}
        />
        <div className="grow" />
        <Segmented
          small
          value={showAll ? 'all' : 'scope'}
          onChange={(v) => setShowAll(v === 'all')}
          options={[
            { value: 'scope', label: '我的类别' },
            { value: 'all', label: '显示全部' },
          ]}
        />
      </div>

      {tab === 'map' ? (
        <CampusMapArt
          showAll={showAll}
          state={state}
          onPick={(sid) => {
            setTab('list')
            setOpenSubject(sid)
          }}
        />
      ) : tab === 'wisdom' ? (
        <div>
          <div className="card mb12">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <Mascot mood="idle" size={40} />
              <p className="fs12 muted grow">
                每个科目有一颗智慧树,你的学习进度就是它的养料——做题越多、掌握越好,树就长得越快。
                从破土发芽到枝繁叶茂,再到结出金色智慧果,见证你的备考之路!
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {subjects.map((s) => {
              const kpsOf = state.kps.filter((k) => k.subjectId === s.id)
              const masteredCount = kpsOf.filter((k) => k.status === 'mastered').length
              const attempts = state.attempts.filter((a) => a.subjectId === s.id).length
              const sm = subjectMastery(state, s.id)
              const kpProg = kpsOf.length > 0 ? masteredCount / kpsOf.length : 0
              const pracProg = kpsOf.length > 0 ? Math.min(attempts / (kpsOf.length * 3), 1) : 0
              const masteryProg = sm != null ? sm / 100 : 0
              const progress = Math.round((kpProg * 0.3 + pracProg * 0.2 + masteryProg * 0.5) * 100)
              const ts = getTreeStage(progress)
              return (
                <div key={s.id} className="card" style={{ textAlign: 'center', padding: '14px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <WisdomTreeSVG stage={ts.stage} color={s.color} size={80} label={s.name} sub={ts.label} />
                  </div>
                  <div className="bar-row mt8">
                    <Bar value={progress} tone={progress >= 90 ? 'green' : progress >= 50 ? 'yellow' : 'blue'} />
                    <span className="val num">{progress}%</span>
                  </div>
                  <div className="fs11 muted mt8 num">
                    已掌握 {masteredCount}/{kpsOf.length} 知识点 · 练习 {attempts} 次
                  </div>
                  {ts.stage >= 6 && (
                    <div className="fs11 mt8" style={{ color: '#DAA520', fontWeight: 700 }}>
                      ★ 智慧果成熟了!
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {subjects.length === 0 && (
            <EmptyState mood="idle" title="智慧园还是空的" desc="先到列表管理创建科目和知识点,智慧树才会种下。" />
          )}
          <p className="fs12 muted mt12" style={{ textAlign: 'center' }}>
            养料来源:做题量 × 20% + 掌握知识点 × 30% + 科目掌握度 × 50%。学习越勤奋,树长得越快,最终结出金色智慧果!
          </p>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {subjects.length === 0 && (
            <EmptyState
              mood="remind"
              title="还没有科目"
              desc="创建第一个科目,比如「大学英语」,然后往里添加章节和知识点。"
              action={
                <button className="btn btn-primary" onClick={() => { openForm({}); setModal({ kind: 'addSubject' }) }}>
                  新增科目
                </button>
              }
            />
          )}
          {subjects.map((s) => {
            const chs = state.chapters.filter((c) => c.subjectId === s.id).sort((a, b) => a.order - b.order)
            const kpsOf = state.kps.filter((k) => k.subjectId === s.id)
            const m = subjectMastery(state, s.id)
            const acc = subjectAccuracy(state, s.id)
            const open = openSubject === s.id
            return (
              <div key={s.id} className="node">
                <div className="node-h">
                  <button className="mini-btn" aria-label={open ? '收起' : '展开'} onClick={() => setOpenSubject(open ? null : s.id)}>
                    <Icon name={open ? 'down' : 'right'} size={13} />
                  </button>
                  <span className="dot" style={{ background: s.color, width: 11, height: 11 }} />
                  <b className="fs14">{s.name}</b>
                  {s.elective && (
                    <Chip tone={state.profile?.elective === s.elective ? 'green' : 'gray'}>
                      {state.profile?.elective === s.elective ? '当前公共课' : '二选一·未选'}
                    </Chip>
                  )}
                  <span className="fs12 muted num">
                    {chs.length} 章 · {kpsOf.length} 个知识点
                  </span>
                  <Chip tone={masteryTone(m) === 'gray' ? 'gray' : masteryTone(m)}>{m == null ? '数据不足' : `掌握 ${m}%`}</Chip>
                  <Chip tone="blue">{acc == null ? '未练习' : `正确率 ${Math.round(acc * 100)}%`}</Chip>
                  <div className="grow" />
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const c = chs[0]
                      if (!c) {
                        toast('请先给这个科目添加章节', { kind: 'error' })
                        return
                      }
                      setModal({ kind: 'import', subjectId: s.id })
                    }}
                  >
                    <Icon name="upload" size={12} /> 导入大纲
                  </button>
                  <button className="mini-btn" aria-label="编辑科目" onClick={() => { openForm({ name: s.name, color: s.color, target: s.targetScore }); setModal({ kind: 'editSubject', subject: s }) }}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button className="mini-btn" aria-label="添加章节" onClick={() => { openForm({}); setModal({ kind: 'addChapter', subjectId: s.id }) }}>
                    <Icon name="plus" size={13} />
                  </button>
                  <button className="mini-btn" aria-label="上移科目" disabled={s.order === 0} onClick={() => dispatch({ type: 'MOVE_ITEM', kind: 'subject', id: s.id, dir: -1 })}>
                    <Icon name="up" size={13} />
                  </button>
                  <button className="mini-btn" aria-label="下移科目" disabled={s.order === subjects.length - 1} onClick={() => dispatch({ type: 'MOVE_ITEM', kind: 'subject', id: s.id, dir: 1 })}>
                    <Icon name="down" size={13} />
                  </button>
                  <button
                    className="mini-btn danger"
                    aria-label="删除科目"
                    onClick={async () => {
                      const ok = await confirm({ title: `删除「${s.name}」?`, desc: '该科目的章节、知识点和题目会一并删除(可在提示中撤销)。', danger: true, confirmText: '删除' })
                      if (ok) {
                        dispatch({ type: 'DELETE_SUBJECT', id: s.id })
                        toast('已删除科目', { action: { label: '撤销', onClick: undo } })
                      }
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
                <div className="node-h" style={{ paddingTop: 0 }}>
                  <div className="bar-row w100">
                    <span className="lbl">科目掌握度</span>
                    <Bar value={m} tone={masteryTone(m)} />
                  </div>
                </div>

                {open && (
                  <div className="node-kids">
                    {chs.length === 0 && <p className="fs12 muted">还没有章节,点右上「+」添加,或用「导入大纲」粘贴文本快速创建。</p>}
                    {chs.map((c) => {
                      const kps = chapterKps(state, c.id)
                      const cm = chapterMastery(state, c.id)
                      const cOpen = openChapter === c.id
                      return (
                        <div key={c.id} className="node" style={{ boxShadow: 'none' }}>
                          <div className="node-h">
                            <button className="mini-btn" aria-label={cOpen ? '收起' : '展开'} onClick={() => setOpenChapter(cOpen ? null : c.id)}>
                              <Icon name={cOpen ? 'down' : 'right'} size={12} />
                            </button>
                            <b className="fs13">{c.name}</b>
                            <span className="fs12 muted num">{kps.length} 个知识点</span>
                            <div style={{ width: 120 }}>
                              <Bar value={cm} tone={masteryTone(cm)} />
                            </div>
                            <div className="grow" />
                            <button className="mini-btn" aria-label="添加知识点" onClick={() => { openForm({}); setModal({ kind: 'addKp', chapterId: c.id }) }}>
                              <Icon name="plus" size={12} />
                            </button>
                            <button className="mini-btn" aria-label="编辑章节" onClick={() => { openForm({ name: c.name }); setModal({ kind: 'editChapter', chapter: c }) }}>
                              <Icon name="edit" size={12} />
                            </button>
                            <button className="mini-btn" aria-label="上移章节" disabled={c.order === 0} onClick={() => dispatch({ type: 'MOVE_ITEM', kind: 'chapter', id: c.id, dir: -1, parentId: s.id })}>
                              <Icon name="up" size={12} />
                            </button>
                            <button className="mini-btn" aria-label="下移章节" disabled={c.order === chs.length - 1} onClick={() => dispatch({ type: 'MOVE_ITEM', kind: 'chapter', id: c.id, dir: 1, parentId: s.id })}>
                              <Icon name="down" size={12} />
                            </button>
                            <button
                              className="mini-btn danger"
                              aria-label="删除章节"
                              onClick={async () => {
                                const ok = await confirm({ title: `删除「${c.name}」?`, desc: '章节下的知识点和题目会一并删除(可撤销)。', danger: true, confirmText: '删除' })
                                if (ok) {
                                  dispatch({ type: 'DELETE_CHAPTER', id: c.id })
                                  toast('已删除章节', { action: { label: '撤销', onClick: undo } })
                                }
                              }}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>

                          {cOpen && (
                            <div className="node-kids" style={{ paddingLeft: 12 }}>
                              {kps.length === 0 && <p className="fs12 muted">这个章节还没有知识点。</p>}
                              {kps.map((k) => {
                                const km = getMastery(state, k)
                                const wrongEntry = Object.values(state.wrong).find((w) => w.kpId === k.id && !w.archived)
                                const accKp = k.stats.attempts > 0 ? Math.round((k.stats.correct / k.stats.attempts) * 100) : null
                                return (
                                  <div key={k.id} className="kp-row">
                                    <select
                                      className="input"
                                      style={{ width: 96, height: 26, fontSize: 12 }}
                                      value={k.status}
                                      onChange={(e) => dispatch({ type: 'UPDATE_KP', id: k.id, patch: { status: e.target.value as KPStatus } })}
                                      aria-label="知识点状态"
                                    >
                                      {KP_STATUS_ORDER.map((st) => (
                                        <option key={st} value={st}>
                                          {KP_STATUS_TEXT[st]}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="name">
                                      <button className="link-btn" style={{ fontSize: 13, fontWeight: 500 }} onClick={() => setDetailKpId(k.id)} title="查看知识点详情">
                                        {k.name}
                                      </button>
                                    </span>
                                    <span className={`chip num ${km == null ? '' : km < 60 ? 'chip-red' : km < 80 ? 'chip-yellow' : 'chip-green'}`}>
                                      {km == null ? '数据不足' : `${km}%`}
                                    </span>
                                    <span className="stats num">
                                      练 {k.stats.attempts}
                                      {accKp != null && ` · 对 ${accKp}%`}
                                      {k.stats.wrongCount > 0 && ` · 错 ${k.stats.wrongCount}`}
                                      {wrongEntry?.nextReviewAt && ` · ${fmtDate(wrongEntry.nextReviewAt)} 复习`}
                                    </span>
                                    <div className="grow" />
                                    <button
                                      className="btn btn-sm"
                                      onClick={() => {
                                        const sess = startKpPractice(state, k.id, 6)
                                        if (!sess) {
                                          toast('该知识点暂无题目,先去题库添加', { kind: 'error' })
                                          return
                                        }
                                        dispatch({ type: 'START_SESSION', session: sess })
                                        nav('practice')
                                      }}
                                    >
                                      练
                                    </button>
                                    <button className="mini-btn" aria-label="编辑知识点" onClick={() => { openForm({ name: k.name, status: k.status, notes: k.notes }); setModal({ kind: 'editKp', kp: k }) }}>
                                      <Icon name="edit" size={12} />
                                    </button>
                                    <button className="mini-btn" aria-label="上移" disabled={k.order === 0} onClick={() => dispatch({ type: 'MOVE_ITEM', kind: 'kp', id: k.id, dir: -1, parentId: c.id })}>
                                      <Icon name="up" size={12} />
                                    </button>
                                    <button className="mini-btn" aria-label="下移" disabled={k.order === kps.length - 1} onClick={() => dispatch({ type: 'MOVE_ITEM', kind: 'kp', id: k.id, dir: 1, parentId: c.id })}>
                                      <Icon name="down" size={12} />
                                    </button>
                                    <button
                                      className="mini-btn danger"
                                      aria-label="删除知识点"
                                      onClick={async () => {
                                        const ok = await confirm({ title: `删除「${k.name}」?`, desc: '知识点下的题目会一并删除(可撤销)。', danger: true, confirmText: '删除' })
                                        if (ok) {
                                          dispatch({ type: 'DELETE_KP', id: k.id })
                                          toast('已删除知识点', { action: { label: '撤销', onClick: undo } })
                                        }
                                      }}
                                    >
                                      <Icon name="trash" size={12} />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ---------- 弹层们 ---------- */}
      <Modal
        open={modal.kind === 'addSubject' || modal.kind === 'editSubject'}
        title={modal.kind === 'addSubject' ? '新增科目' : '编辑科目'}
        onClose={close}
        footer={
          <>
            <button className="btn" onClick={close}>取消</button>
            <button className="btn btn-primary" onClick={saveModal}>保存</button>
          </>
        }
      >
        <Field label="科目名称">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如:大学英语" />
        </Field>
        <Field label="目标分数">
          <input className="input" type="number" min={0} max={100} value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} />
        </Field>
        <Field label="标识颜色">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {PALETTE.map((c) => (
              <button key={c} className="mini-btn" style={{ background: c, border: form.color === c ? '2px solid var(--ink)' : 'none', width: 28, height: 28 }} aria-label={`选择颜色 ${c}`} onClick={() => setForm({ ...form, color: c })} />
            ))}
          </div>
        </Field>
      </Modal>

      <Modal
        open={modal.kind === 'addChapter' || modal.kind === 'editChapter'}
        title={modal.kind === 'addChapter' ? '新增章节' : '编辑章节'}
        onClose={close}
        footer={
          <>
            <button className="btn" onClick={close}>取消</button>
            <button className="btn btn-primary" onClick={saveModal}>保存</button>
          </>
        }
      >
        <Field label="章节名称">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如:函数与极限" />
        </Field>
      </Modal>

      <Modal
        open={modal.kind === 'addKp' || modal.kind === 'editKp'}
        title={modal.kind === 'addKp' ? '新增知识点' : '编辑知识点'}
        onClose={close}
        footer={
          <>
            <button className="btn" onClick={close}>取消</button>
            <button className="btn btn-primary" onClick={saveModal}>保存</button>
          </>
        }
      >
        <Field label="知识点名称">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如:现在完成时" />
        </Field>
        <Field label="当前状态" hint="也可在做题后由系统自动更新">
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as KPStatus })}>
            {KP_STATUS_ORDER.map((st) => (
              <option key={st} value={st}>
                {KP_STATUS_TEXT[st]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="学习笔记" hint="记录定义、公式、易错点">
          <textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="这一点的核心内容……" />
        </Field>
        {modal.kind === 'editKp' && (
          <p className="fs12 muted">
            练习 {modal.kp.stats.attempts} 次 · 正确 {modal.kp.stats.correct} 次 · 错误 {modal.kp.stats.wrongCount} 次
          </p>
        )}
      </Modal>

      <Modal
        open={modal.kind === 'import'}
        title="粘贴文本导入大纲"
        onClose={close}
        width={600}
        footer={
          <>
            <button className="btn" onClick={close}>取消</button>
            <button className="btn btn-primary" disabled={outlineParsed.length === 0} onClick={saveModal}>
              确认导入({outlineParsed.length} 章)
            </button>
          </>
        }
      >
        <p className="fs13 mb8">
          每行一条:<b>「第X章 ……」</b>识别为章节,其余行识别为该章下的知识点。
        </p>
        <textarea
          className="input"
          style={{ minHeight: 160 }}
          value={outlineText}
          onChange={(e) => setOutlineText(e.target.value)}
          placeholder={'第一章 函数与极限\n- 函数定义域\n- 重要极限\n第二章 导数与微分\n- 导数计算'}
        />
        <div className="col mt12" style={{ gap: 6 }}>
          {outlineParsed.map((c, i) => (
            <div key={i} className="fs13">
              <b>{c.name}</b> <span className="muted">({c.kps.length} 个知识点): {c.kps.slice(0, 4).join('、')}{c.kps.length > 4 ? ' …' : ''}</span>
            </div>
          ))}
        </div>
        <p className="fs12 muted mt12">重名章节与知识点会自动跳过;导入不会改动或删除任何已有学习记录。</p>
      </Modal>

      <KPDetail kp={detailKp} onClose={() => setDetailKpId(null)} />
    </div>
  )
}

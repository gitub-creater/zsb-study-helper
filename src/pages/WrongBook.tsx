// 错题本:到期复习 / 错误原因 / 间隔进度 / 归档
import React, { useMemo, useState } from 'react'
import type { WrongEntry, WrongReason } from '../types'
import { WRONG_REASONS } from '../types'
import { useStore } from '../store/store'
import { EmptyState, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { makeSession } from '../lib/practice'
import { intervalStageText } from '../lib/spaced'
import { fmtDate, todayStr } from '../lib/date'
import { nav } from '../lib/misc'

function StageDots({ entry }: { entry: WrongEntry }) {
  const { state } = useStore()
  const intervals = state.settings.intervals
  return (
    <span className="stage-dots" title={`复习间隔:${intervalStageText(intervals)}`}>
      {intervals.map((_, i) => (
        <i key={i} className={i <= entry.intervalIndex ? 'on' : ''} />
      ))}
      <span>
        第 {entry.intervalIndex + 1} 档 · {intervals[entry.intervalIndex]} 天
      </span>
    </span>
  )
}

export function WrongBook() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()
  const [filter, setFilter] = useState<'due' | 'all' | 'archived'>('due')
  const [subjectId, setSubjectId] = useState('')
  const [reasonFor, setReasonFor] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const today = todayStr()

  const entries = useMemo(() => {
    return Object.values(state.wrong)
      .filter((e) => {
        if (filter === 'archived') return e.archived
        if (e.archived) return false
        if (filter === 'due') return e.nextReviewAt != null && e.nextReviewAt <= today
        return true
      })
      .filter((e) => !subjectId || e.subjectId === subjectId)
      .sort((a, b) => ((a.nextReviewAt ?? '9999') < (b.nextReviewAt ?? '9999') ? -1 : 1))
  }, [state.wrong, filter, subjectId, today])

  const dueCount = Object.values(state.wrong).filter((e) => !e.archived && e.nextReviewAt != null && e.nextReviewAt <= today).length
  const archivedCount = Object.values(state.wrong).filter((e) => e.archived).length

  const reviewOne = (qid: string) => {
    const s = makeSession({ mode: 'wrong', name: '错题复习', questionIds: [qid] })
    dispatch({ type: 'START_SESSION', session: s })
    nav('practice')
  }

  const reviewAll = () => {
    const ids = entries.filter((e) => !e.archived).map((e) => e.questionId)
    if (ids.length === 0) {
      toast('当前筛选下没有可复习的错题')
      return
    }
    const s = makeSession({ mode: 'wrong', name: '错题复习', questionIds: ids })
    dispatch({ type: 'START_SESSION', session: s })
    nav('practice')
  }

  return (
    <div>
      <div className="page-h">
        <h2>错题本</h2>
        <span className="chip chip-red num">{dueCount} 道待复习</span>
        <div className="spacer" />
        <button className="btn btn-primary" disabled={dueCount === 0} onClick={reviewAll}>
          <Icon name="play" size={13} /> 复习全部到期错题
        </button>
      </div>

      <div className="card mb12">
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Segmented
            small
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'due', label: `待复习(${dueCount})` },
              { value: 'all', label: `进行中(${Object.values(state.wrong).filter((e) => !e.archived).length})` },
              { value: 'archived', label: `已克服(${archivedCount})` },
            ]}
          />
          <select className="input" style={{ width: 130 }} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="按科目筛选">
            <option value="">全部科目</option>
            {state.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <div className="grow" />
          <span className="fs12 muted">复习间隔:{intervalStageText(state.settings.intervals)}(可在设置中调整)</span>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          mood={filter === 'due' ? 'happy' : 'think'}
          title={filter === 'due' ? '太棒了,没有到期的错题' : '这里还没有错题'}
          desc={
            filter === 'due'
              ? '到期的错题会出现在这里,按 1 → 3 → 7 → 14 → 30 天的节奏安排复习。'
              : '练习中答错的题会自动收进错题本,并记录错误原因和复习计划。'
          }
          action={
            <button className="btn" onClick={() => nav('bank')}>
              去题库练习
            </button>
          }
        />
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {entries.map((e) => {
            const q = state.questions.find((x) => x.id === e.questionId)
            if (!q) return null
            const subject = state.subjects.find((s) => s.id === e.subjectId)
            const kp = state.kps.find((k) => k.id === e.kpId)
            const open = openId === e.questionId
            return (
              <div key={e.questionId} className="card" style={{ padding: '12px 14px' }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className="dot" style={{ background: subject?.color }} />
                  <span className="chip">{subject?.name}</span>
                  {kp && <span className="chip chip-blue">{kp.name}</span>}
                  <span className="chip chip-red num">错 {e.wrongCount} 次</span>
                  {e.reason && <span className="chip chip-yellow">{e.reason}</span>}
                  {e.archived ? (
                    <span className="chip chip-green">已克服</span>
                  ) : e.nextReviewAt && e.nextReviewAt <= today ? (
                    <span className="chip chip-red">今天该复习了</span>
                  ) : (
                    e.nextReviewAt && <span className="chip num">{fmtDate(e.nextReviewAt)} 复习</span>
                  )}
                  <div className="grow" />
                  {!e.archived && (
                    <button className="btn btn-sm btn-primary" onClick={() => reviewOne(e.questionId)}>
                      去复习
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => setOpenId(open ? null : e.questionId)}>
                    {open ? '收起' : '详情'}
                  </button>
                </div>

                <p className="clamp2 fs13 mt8">{q.stem}</p>

                {!e.archived && (
                  <div className="row mt8">
                    <StageDots entry={e} />
                    <div className="grow" />
                    <button className="fs12 link-btn" onClick={() => setReasonFor(e.questionId)}>
                      {e.reason ? `原因:${e.reason}` : '标记错误原因'} <Icon name="edit" size={11} />
                    </button>
                  </div>
                )}

                {open && (
                  <div className="explain-box mt8">
                    <b>你的答案:</b>{e.lastUserAnswer || '(未作答)'} / <b style={{ color: 'var(--green-deep)' }}>标准答案:</b>{e.correctAnswer}
                    {'\n'}
                    <b>解析:</b>
                    {'\n'}
                    {q.explanation}
                    {e.reviewLog.length > 0 && (
                      <>
                        {'\n'}
                        <b>复习记录:</b>{' '}
                        {e.reviewLog
                          .slice(-6)
                          .map((r) => `${fmtDate(r.date)}${r.correct ? '✓' : '✗'}`)
                          .join('、')}
                      </>
                    )}
                  </div>
                )}

                {open && (
                  <div className="row mt8" style={{ justifyContent: 'flex-end' }}>
                    {!e.archived ? (
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          const ok = await confirm({
                            title: '标记为已掌握?',
                            desc: '这道题会移出复习队列。之后若再答错,会自动回到错题本。',
                            confirmText: '移出错题本',
                          })
                          if (ok) {
                            dispatch({ type: 'ARCHIVE_WRONG', questionId: e.questionId, archived: true })
                            toast('已移出错题本,继续保持!')
                          }
                        }}
                      >
                        标记已掌握,移出错题本
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          dispatch({ type: 'ARCHIVE_WRONG', questionId: e.questionId, archived: false })
                          toast('已放回复习队列')
                        }}
                      >
                        重新加入复习
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!reasonFor} title="选择错误原因" onClose={() => setReasonFor(null)}>
        <div className="reason-chips">
          {WRONG_REASONS.map((r) => (
            <button
              key={r}
              className={reasonFor && state.wrong[reasonFor]?.reason === r ? 'on' : ''}
              onClick={() => {
                if (reasonFor) dispatch({ type: 'SET_WRONG_REASON', questionId: reasonFor, reason: r as WrongReason })
                setReasonFor(null)
                toast('已记录错误原因', { kind: 'success' })
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <p className="fs12 muted mt12">记录原因是为了之后优先补对应的弱项,不影响任何判定。</p>
      </Modal>
    </div>
  )
}

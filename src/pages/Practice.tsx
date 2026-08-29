// 做题流程:作答 → 提交 → 反馈(答案/解析/错误原因)→ 下一题 → 结算
import React, { useEffect, useRef, useState } from 'react'
import type { Question, Session, SessionSummary, WrongReason } from '../types'
import { PRACTICE_MODE_TEXT, QUESTION_TYPE_TEXT, WRONG_REASONS } from '../types'
import { useStore } from '../store/store'
import { Mascot } from '../components/Mascot'
import { EmptyState, Modal, Field, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { Tex } from '../components/Tex'
import { LETTERS, checkAnswer, nav } from '../lib/misc'
import { startKpPractice } from '../lib/practice'

function QuestionCard({
  q,
  answer,
  onSubmit,
}: {
  q: Question
  answer: { userAnswer: string; correct: boolean } | undefined
  onSubmit: (userAnswer: string) => void
}) {
  const [sel, setSel] = useState<string>('') // single: 'A'; multiple: 'ABD'; judge: 'A'
  const [fill, setFill] = useState('')
  const submitted = !!answer

  const toggleMulti = (letter: string) => {
    if (submitted) return
    setSel((cur) => {
      const set = new Set(cur.split(''))
      if (set.has(letter)) set.delete(letter)
      else set.add(letter)
      return [...set].sort().join('')
    })
  }

  const current = q.type === 'fill' ? fill : sel
  const canSubmit = current.trim().length > 0

  return (
    <div className="card q-card">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="chip chip-blue">{QUESTION_TYPE_TEXT[q.type]}</span>
        <span className="chip" title={`难度 ${'★'.repeat(q.difficulty)}`}>
          {'★'.repeat(q.difficulty)}
          <span className="muted">{'☆'.repeat(3 - q.difficulty)}</span>
        </span>
        <span className="chip">{q.source}</span>
        <span className="chip num">{q.year}</span>
        {q.official && <span className="chip chip-green">官方资料</span>}
      </div>
      <div className="stem">
        <Tex text={q.stem} />
      </div>

      {(q.type === 'single' || q.type === 'multiple' || q.type === 'judge') && (
        <div>
          {q.options.map((opt, i) => {
            const letter = LETTERS[i]
            const isSel = submitted ? q.answer.toUpperCase().includes(letter) : sel.includes(letter)
            const isUserPick = submitted && sel.includes(letter)
            const cls = submitted
              ? isSel
                ? 'ok'
                : isUserPick
                  ? 'bad'
                  : 'dim'
              : sel.includes(letter)
                ? 'sel'
                : ''
            return (
              <button
                key={letter}
                type="button"
                className={`opt ${cls}`}
                onClick={() => (q.type === 'multiple' ? toggleMulti(letter) : !submitted && setSel(letter))}
                disabled={submitted}
                aria-pressed={sel.includes(letter)}
              >
                {q.type === 'multiple' ? (
                  <span className="multi-box">
                    <Icon name="check" size={12} />
                  </span>
                ) : (
                  <span className="abc">{letter}</span>
                )}
                <span className="grow">{opt}</span>
              </button>
            )
          })}
        </div>
      )}

      {q.type === 'fill' && (
        <input
          className="input"
          style={{ fontSize: 15 }}
          value={submitted ? answer!.userAnswer : fill}
          onChange={(e) => setFill(e.target.value)}
          placeholder="输入你的答案"
          disabled={submitted}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit && !submitted) onSubmit(fill)
          }}
        />
      )}

      {!submitted && (
        <div className="row mt12" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={() => onSubmit(q.type === 'fill' ? fill : sel)}>
            提交答案
          </button>
        </div>
      )}
    </div>
  )
}

function Feedback({
  q,
  answer,
  wrong,
}: {
  q: Question
  answer: { userAnswer: string; correct: boolean }
  wrong: { reason: WrongReason | null } | undefined
}) {
  const { state, dispatch } = useStore()
  const note = state.questionNotes[q.id] ?? ''
  const [noteOpen, setNoteOpen] = useState(false)
  const [draft, setDraft] = useState(note)
  const fav = state.favorites.includes(q.id)
  const kpName = state.kps.find((k) => k.id === q.kpId)?.name ?? '未知知识点'

  return (
    <div className="col" style={{ gap: 10, marginTop: 10 }}>
      <div className={`fb ${answer.correct ? 'ok' : 'bad'}`}>
        <Icon name={answer.correct ? 'check' : 'close'} size={16} />
        {answer.correct ? '回答正确,继续保持!' : '答错了,看一遍解析再继续。'}
        <span className="chip" style={{ marginLeft: 'auto' }}>
          <Icon name="target" size={12} /> {kpName}
        </span>
      </div>

      <div className="card">
        <div className="row mb8" style={{ flexWrap: 'wrap' }}>
          <span className="chip">你的答案:{answer.userAnswer === '' ? '(超时未作答)' : answer.userAnswer}</span>
          <span className="chip chip-green">标准答案:{q.answer}</span>
          <div className="grow" />
          <button className="btn btn-sm" onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', questionId: q.id })}>
            <Icon name="star" size={13} />
            {fav ? '已收藏' : '收藏'}
          </button>
          <button className="btn btn-sm" onClick={() => setNoteOpen(true)}>
            <Icon name="edit" size={13} />
            笔记
          </button>
          <button
            className="btn btn-sm"
            title="AI 讲题将在第四阶段开放,当前展示题目自带的分步解析"
            disabled
          >
            <Icon name="sparkle" size={13} />
            AI 讲题
          </button>
        </div>
        <div className="explain-box">
          <b>分步解析</b>
          {'\n'}
          <Tex text={q.explanation} />
          {q.wrongAnalysis && (
            <>
              {'\n\n'}
              <b>错误选项分析</b>
              {'\n'}
              <Tex text={q.wrongAnalysis} />
            </>
          )}
        </div>
      </div>

      {!answer.correct && (
        <div className="card">
          <b className="fs13">这道题为什么会错?(帮助定位薄弱原因)</b>
          <div className="reason-chips mt8">
            {WRONG_REASONS.map((r) => (
              <button
                key={r}
                className={wrong?.reason === r ? 'on' : ''}
                onClick={() => dispatch({ type: 'SET_WRONG_REASON', questionId: q.id, reason: r })}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={noteOpen}
        title="题目笔记"
        onClose={() => setNoteOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setNoteOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                dispatch({ type: 'SET_QUESTION_NOTE', questionId: q.id, note: draft })
                setNoteOpen(false)
              }}
            >
              保存
            </button>
          </>
        }
      >
        <Field label="我的笔记" hint="只保存在本地">
          <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="记下易错点、思路……" />
        </Field>
        {note && (
          <p className="fs12 muted">当前已保存:{note}</p>
        )}
      </Modal>
    </div>
  )
}

export function Practice() {
  const { state, dispatch } = useStore()
  const [, confirm] = useConfirm()
  const toast = useToast()
  const s = state.session
  const summary = state.lastSummary
  const [now, setNow] = useState(Date.now())
  const expiredRef = useRef(false)

  // 限时模式倒计时
  useEffect(() => {
    if (!s?.expiresAt) return
    const iv = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(iv)
  }, [s?.expiresAt])

  const questions: Question[] = s
    ? (s.questionIds.map((id) => state.questions.find((q) => q.id === id)).filter(Boolean) as Question[])
    : []

  const buildSummary = (sess: Session): SessionSummary => {
    const entries = Object.entries(sess.answers)
    const wrongKpIds = [
      ...new Set(
        entries
          .filter(([, v]) => !v.correct)
          .map(([qid]) => state.questions.find((q) => q.id === qid)?.kpId ?? '')
      ),
    ].filter(Boolean)
    return {
      mode: sess.mode,
      name: sess.name,
      total: sess.questionIds.length,
      answered: entries.length,
      correct: entries.filter(([, v]) => v.correct).length,
      xpGained: sess.xpGained,
      at: new Date().toISOString(),
      wrongKpIds,
    }
  }

  const finish = (sess: Session) => {
    const sum = buildSummary(sess)
    dispatch({ type: 'END_SESSION', summary: sum })
    if (sum.answered > 0) toast(`练习完成,获得 ${sum.xpGained} 经验`, { kind: 'success' })
  }

  // 超时自动交卷
  useEffect(() => {
    if (!s?.expiresAt || expiredRef.current) return
    if (now > s.expiresAt) {
      expiredRef.current = true
      const q = questions[s.index]
      if (q && !s.answers[q.id]) {
        dispatch({ type: 'ANSWER', questionId: q.id, userAnswer: '', correct: false, mode: s.mode })
      }
      // 用最新会话结算
      const latest = { ...s, answers: { ...s.answers } }
      if (q && !s.answers[q.id]) latest.answers[q.id] = { userAnswer: '', correct: false }
      finish(latest)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now])

  // ---- 结算页 ----
  if (!s) {
    if (summary) {
      const acc = summary.answered > 0 ? Math.round((summary.correct / summary.answered) * 100) : 0
      return (
        <div className="practice">
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Mascot mood={summary.correct === summary.answered && summary.answered > 0 ? 'happy' : 'idle'} size={88} />
            </div>
            <h2 style={{ fontSize: 18, marginTop: 6 }}>{summary.name} · 练习结束</h2>
            {summary.answered < summary.total && (
              <p className="fs13 muted mt8">时间到,有 {summary.total - summary.answered} 题未作答,不要紧,下次会更快。</p>
            )}
            <div className="summary-stats">
              <div className="box">
                <b className="num">{summary.answered}</b>
                <span>已作答</span>
              </div>
              <div className="box">
                <b className="num" style={{ color: 'var(--green-deep)' }}>
                  {acc}%
                </b>
                <span>正确率</span>
              </div>
              <div className="box">
                <b className="num" style={{ color: 'var(--yellow-deep)' }}>
                  +{summary.xpGained}
                </b>
                <span>经验</span>
              </div>
            </div>
            {summary.wrongKpIds.length > 0 && (
              <p className="fs13">
                有 {summary.wrongKpIds.length} 个知识点答错了,已自动加入错题本并安排复习。
              </p>
            )}
            <div className="row mt12" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              {summary.wrongKpIds.length > 0 && (
                <button
                  className="btn btn-soft"
                  onClick={() => {
                    const ns = startKpPractice(state, summary.wrongKpIds[0], 6)
                    if (!ns) {
                      toast('相似题不足,可去题库筛选')
                      return
                    }
                    dispatch({ type: 'START_SESSION', session: ns })
                  }}
                >
                  练习同知识点相似题
                </button>
              )}
              <button className="btn" onClick={() => nav('wrong')}>
                去错题本看看
              </button>
              <button className="btn btn-primary" onClick={() => nav('today')}>
                返回今日学习
              </button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <EmptyState
        mood="idle"
        title="当前没有进行中的练习"
        desc="去题库或今日任务里开始一组练习吧。"
        action={
          <button className="btn btn-primary" onClick={() => nav('today')}>
            返回今日学习
          </button>
        }
      />
    )
  }

  // ---- 做题页 ----
  const q = questions[s.index]
  if (!q) {
    finish(s)
    return null
  }
  const answer = s.answers[q.id]
  const isLast = s.index >= questions.length - 1
  const remainSec = s.expiresAt ? Math.max(0, Math.round((s.expiresAt - now) / 1000)) : null

  return (
    <div className="practice">
      <div className="practice-top">
        <button
          className="btn btn-sm"
          onClick={async () => {
            const ok = await confirm({
              title: '结束本次练习?',
              desc: '已经作答的题目会正常计入统计和错题本,未作答的不会扣任何东西。',
              confirmText: '结束练习',
            })
            if (ok) finish(s)
          }}
        >
          <Icon name="left" size={13} /> 退出
        </button>
        <b className="fs14" style={{ fontSize: 14 }}>
          {s.name}
        </b>
        <div className="pbar">
          <i style={{ width: `${((s.index + (answer ? 1 : 0)) / questions.length) * 100}%` }} />
        </div>
        <span className="fs13 num">
          {s.index + 1}/{questions.length}
        </span>
        {remainSec != null && (
          <span className={`chip num ${remainSec < 60 ? 'chip-red' : 'chip-blue'}`}>
            <Icon name="timer" size={12} />
            {Math.floor(remainSec / 60)}:{String(remainSec % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      <QuestionCard
        key={q.id}
        q={q}
        answer={answer}
        onSubmit={(userAnswer) => {
          dispatch({ type: 'ANSWER', questionId: q.id, userAnswer, correct: checkAnswer(q, userAnswer), mode: s.mode })
        }}
      />

      {answer && <Feedback q={q} answer={answer} wrong={state.wrong[q.id]} />}

      {answer && (
        <div className="row mt12" style={{ justifyContent: 'flex-end' }}>
          {isLast ? (
            <button className="btn btn-primary btn-lg" onClick={() => finish(s)}>
              完成练习
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'ADVANCE_SESSION' })}>
              下一题
            </button>
          )}
        </div>
      )}
    </div>
  )
}

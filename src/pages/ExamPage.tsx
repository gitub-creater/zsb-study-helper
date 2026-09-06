// 模拟考试:配置组卷 → 限时作答(自动交卷) → 成绩单(章节得分率/错题解析) → 历史曲线
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Icon } from '../components/Icon'
import { EmptyState, Field, useConfirm, useToast } from '../components/ui'
import { Tex } from '../components/Tex'
import { buildPaper, chapterBreakdown, eligibleQuestions, gradeExam, suggestMinutes } from '../lib/exam'
import { LETTERS, uid } from '../lib/misc'
import { subjectInScope } from '../lib/selectors'
import type { ExamAttempt, Question } from '../types'

export function ExamPage() {
  const { state } = useStore()
  const [route, setRoute] = useState(() => window.location.hash.split('?')[1] ?? '')
  useEffect(() => {
    const h = () => setRoute(window.location.hash.split('?')[1] ?? '')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const reportId = new URLSearchParams(route).get('report')
  if (reportId) return <ExamReport attemptId={reportId} />
  const exam = state.activeExam
  if (exam && !exam.finishedAt) return <ExamRunner attempt={exam} />
  return <ExamHome />
}

// ---------- 配置 + 历史 ----------

function ExamHome() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const inScope = useMemo(() => state.subjects.filter((s) => !s.legacy && subjectInScope(state, s) && state.questions.some((q) => q.subjectId === s.id)), [state])
  const [subjectId, setSubjectId] = useState(inScope[0]?.id ?? '')
  const [count, setCount] = useState(15)
  const [minutes, setMinutes] = useState(25)
  const [totalScore, setTotalScore] = useState(100)
  const history = state.examHistory ?? []
  const lastReportId = history[0]?.id

  const pool = eligibleQuestions(state, subjectId)
  const realCount = Math.min(count, pool.length)

  function start() {
    if (realCount < 1) {
      toast('该科目暂无可用题目,先去题库导入或切换科目', { kind: 'error' })
      return
    }
    const paper = buildPaper(pool, realCount)
    const subject = state.subjects.find((s) => s.id === subjectId)
    const attempt: ExamAttempt = {
      id: uid('ex'),
      name: `${subject?.name ?? '综合'} · 模拟考`,
      subjectId,
      questionIds: paper.map((q) => q.id),
      answers: {},
      startedAt: new Date().toISOString(),
      durationMinutes: minutes,
      totalScore,
      perQuestionScore: Math.round((totalScore / paper.length) * 100) / 100,
    }
    dispatch({ type: 'EXAM_START', attempt })
  }

  return (
    <div className="page exam-page">
      {confirmNode}
      <section className="card">
        <div className="card-h">
          <b>开始一场模拟考</b>
          <span className="muted">限时作答,到期自动交卷;成绩与错题自动进入成绩单</span>
        </div>
        {inScope.length === 0 ? (
          <EmptyState mood="think" title="还没有可考的科目" desc="先到「题库」导入题目后再来。" />
        ) : (
          <>
            <div className="exam-setup">
              <Field label="考试科目">
                <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="考试科目">
                  {inScope.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}({state.questions.filter((q) => q.subjectId === s.id).length} 题)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`题量:${realCount} 题${count > pool.length ? '(题库不足,已按上限)' : ''}`}>
                <div className="seg">
                  {[10, 15, 20, 30, 50].map((n) => (
                    <button key={n} type="button" className={count === n ? 'on' : ''} onClick={() => { setCount(n); setMinutes(suggestMinutes(n)) }}>
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="限时(分钟)">
                <input type="number" min={5} max={180} value={minutes} onChange={(e) => setMinutes(Math.min(180, Math.max(5, Number(e.target.value) || 30)))} aria-label="考试时长" />
              </Field>
              <Field label="卷面总分">
                <input type="number" min={10} max={150} step={10} value={totalScore} onChange={(e) => setTotalScore(Math.min(150, Math.max(10, Number(e.target.value) || 100)))} aria-label="卷面总分" />
              </Field>
            </div>
            <button className="btn btn-primary btn-lg w100 mt8" onClick={start} disabled={realCount < 1}>
              <Icon name="play" size={15} /> 开始考试({realCount} 题 · {minutes} 分钟)
            </button>
          </>
        )}
      </section>

      {history.length > 0 && (
        <section className="card">
          <div className="card-h">
            <b>历史成绩</b>
            <span className="muted">最近 {history.length} 场</span>
          </div>
          <TrendChart history={history} />
          <ul className="exam-history">
            {history.slice(0, 10).map((h) => (
              <li key={h.id}>
                <span className="num exam-score">{h.score ?? 0}</span>
                <span className="exam-h-main">
                  <b>{h.name}</b>
                  <span className="muted num">
                    {new Date(h.finishedAt ?? h.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.questionIds.length} 题 · 用时 {Math.round((h.usedSeconds ?? 0) / 60)} 分
                  </span>
                </span>
                {h.id === lastReportId && (
                  <a className="btn btn-sm" href={`#/exam?report=${h.id}`}>
                    查看成绩单
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** 历史分数折线(SVG,无依赖) */
function TrendChart({ history }: { history: ExamAttempt[] }) {
  const list = [...history].reverse().slice(-20)
  if (list.length < 2) return null
  const w = 560
  const h = 120
  const scores = list.map((x) => x.score ?? 0)
  const max = Math.max(...list.map((x) => x.totalScore), 1)
  const pts = scores.map((s, i) => `${(i / (list.length - 1)) * (w - 40) + 20},${h - 16 - (s / max) * (h - 36)}`).join(' ')
  return (
    <svg className="exam-trend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="历史成绩趋势">
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.split(' ').map((p) => {
        const [x, y] = p.split(',').map(Number)
        return <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="var(--primary)" />
      })}
    </svg>
  )
}

// ---------- 限时作答 ----------

function ExamRunner({ attempt }: { attempt: ExamAttempt }) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const [now, setNow] = useState(Date.now())
  const [idx, setIdx] = useState(0)
  const finished = useRef(false)

  const questions = useMemo(
    () => attempt.questionIds.map((id) => state.questions.find((q) => q.id === id)).filter(Boolean) as Question[],
    [attempt.questionIds, state.questions]
  )
  const endsAt = new Date(attempt.startedAt).getTime() + attempt.durationMinutes * 60000
  const remainSec = Math.max(0, Math.round((endsAt - now) / 1000))

  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(iv)
  }, [])

  function finish() {
    if (finished.current) return
    finished.current = true
    const grade = gradeExam(questions, attempt.answers, attempt.totalScore)
    const used = Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 1000)
    dispatch({ type: 'EXAM_FINISH', score: grade.score, usedSeconds: used })
    window.location.hash = `#/exam?report=${attempt.id}`
  }

  // 到期自动交卷
  useEffect(() => {
    if (remainSec <= 0 && !finished.current) {
      toast('时间到,已自动交卷', { kind: 'info' })
      finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainSec])

  const q = questions[idx]
  const answered = Object.keys(attempt.answers).filter((k) => (attempt.answers[k] ?? '').trim() !== '')

  async function submit() {
    const ok = await confirm({
      title: '交卷',
      desc: `已答 ${answered.length}/${questions.length} 题,未答的题按 0 分计。确定交卷吗?`,
      confirmText: '交卷',
    })
    if (ok) finish()
  }

  const mm = String(Math.floor(remainSec / 60)).padStart(2, '0')
  const ss = String(remainSec % 60).padStart(2, '0')
  const urgent = remainSec < 120

  return (
    <div className="page exam-page runner">
      {confirmNode}
      <div className="exam-head card">
        <b>{attempt.name}</b>
        <span className={`chip num ${urgent ? 'chip-red' : 'chip-blue'}`}>
          <Icon name="timer" size={12} /> 剩余 {mm}:{ss}
        </span>
        <span className="muted num">
          已答 {answered.length}/{questions.length}
        </span>
        <span className="grow" />
        <button className="btn btn-sm btn-primary" onClick={() => void submit()}>
          交卷
        </button>
      </div>

      <div className="exam-nav num" role="tablist" aria-label="题目导航">
        {questions.map((qq, i) => {
          const done = (attempt.answers[qq.id] ?? '').trim() !== ''
          return (
            <button key={qq.id} type="button" className={`exam-nav-dot${i === idx ? ' cur' : ''}${done ? ' done' : ''}`} onClick={() => setIdx(i)} aria-label={`第 ${i + 1} 题${done ? '(已答)' : ''}`}>
              {i + 1}
            </button>
          )
        })}
      </div>

      {q ? (
        <section className="card exam-q">
          <div className="exam-q-h num">
            <span className="chip chip-blue">第 {idx + 1} / {questions.length} 题</span>
            <span className="muted">{attempt.perQuestionScore} 分</span>
          </div>
          <div className="exam-stem">
            <Tex text={q.stem} />
          </div>
          {q.options.length > 0 ? (
            <ul className="exam-opts">
              {q.options.map((opt, i) => {
                const letter = LETTERS[i]
                const multi = q.type === 'multiple'
                const cur = attempt.answers[q.id] ?? ''
                const on = multi ? cur.includes(letter) : cur === letter
                return (
                  <li key={i}>
                    <button
                      type="button"
                      className={`exam-opt${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => {
                        if (multi) {
                          const next = on ? cur.replace(letter, '').split('').sort().join('') : (cur + letter).split('').sort().join('')
                          dispatch({ type: 'EXAM_ANSWER', questionId: q.id, answer: next })
                        } else {
                          dispatch({ type: 'EXAM_ANSWER', questionId: q.id, answer: letter })
                        }
                      }}
                    >
                      <b>{letter}</b>
                      <Tex text={opt} />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Field label="填空答案">
              <input
                value={attempt.answers[q.id] ?? ''}
                onChange={(e) => dispatch({ type: 'EXAM_ANSWER', questionId: q.id, answer: e.target.value })}
                placeholder="输入答案"
                aria-label="填空答案"
              />
            </Field>
          )}
          <div className="exam-q-ops">
            <button className="btn btn-sm" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
              <Icon name="left" size={13} /> 上一题
            </button>
            {idx < questions.length - 1 ? (
              <button className="btn btn-sm btn-primary" onClick={() => setIdx((i) => i + 1)}>
                下一题 <Icon name="right" size={13} />
              </button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={() => void submit()}>
                <Icon name="check" size={13} /> 交卷
              </button>
            )}
          </div>
        </section>
      ) : (
        <EmptyState mood="think" title="题目缺失" desc="题目可能已被删除,请交卷或放弃本场。" action={<button className="btn btn-danger-solid" onClick={() => { dispatch({ type: 'EXAM_ABORT' }); }}>放弃本场</button>} />
      )}
    </div>
  )
}

// ---------- 成绩单 ----------

export function ExamReport({ attemptId }: { attemptId: string }) {
  const { state } = useStore()
  const history = state.examHistory ?? []
  const attempt = history.find((x) => x.id === attemptId) ?? history[0]
  if (!attempt) {
    return (
      <div className="page exam-page">
        <EmptyState mood="think" title="没有找到成绩单" action={<a className="btn btn-primary" href="#/exam">返回模拟考试</a>} />
      </div>
    )
  }
  const questions = attempt.questionIds.map((id) => state.questions.find((q) => q.id === id)).filter(Boolean) as Question[]
  const grade = gradeExam(questions, attempt.answers, attempt.totalScore)
  const chapters = chapterBreakdown(grade.detail, state.chapters, attempt.totalScore)
  const rate = attempt.totalScore > 0 ? (grade.score / attempt.totalScore) * 100 : 0

  return (
    <div className="page exam-page">
      <a className="btn btn-sm back" href="#/exam">
        <Icon name="left" size={14} /> 返回
      </a>
      <section className="card exam-report">
        <div className="exam-score-hero num">
          <b>{grade.score}</b>
          <span>/ {attempt.totalScore} 分</span>
          <span className={`chip chip-${rate >= 80 ? 'green' : rate >= 60 ? 'blue' : 'red'}`}>得分率 {Math.round(rate)}%</span>
        </div>
        <div className="exam-meta num">
          <span>
            <Icon name="check" size={13} /> 对 {grade.correctCount} 题
          </span>
          <span>
            <Icon name="close" size={13} /> 错 {grade.wrongIds.length} 题
          </span>
          <span>
            <Icon name="clock" size={13} /> 用时 {Math.round((attempt.usedSeconds ?? 0) / 60)} 分钟
          </span>
          <span>{new Date(attempt.finishedAt ?? attempt.startedAt).toLocaleString('zh-CN')}</span>
        </div>

        {chapters.length > 0 && (
          <>
            <b className="exam-sub">章节得分(薄弱在前)</b>
            <ul className="exam-chapters">
              {chapters.map((c) => (
                <li key={c.chapterId}>
                  <span className="exam-ch-name">{c.name}</span>
                  <div className="bar">
                    <i className={c.rate >= 0.8 ? 'tone-green' : c.rate >= 0.5 ? 'tone-blue' : 'tone-red'} style={{ width: `${Math.round(c.rate * 100)}%` }} />
                  </div>
                  <span className="num muted">
                    {c.score}/{c.total}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {grade.wrongIds.length > 0 && (
          <>
            <b className="exam-sub">错题解析({grade.wrongIds.length})</b>
            <ul className="exam-wrongs">
              {grade.detail
                .filter((d) => !d.correct)
                .map((d) => (
                  <li key={d.question.id} className="exam-wrong">
                    <div className="exam-stem small">
                      <Tex text={d.question.stem} />
                    </div>
                    <div className="num">
                      <span className="chip chip-red">我的答案:{d.userAnswer || '未作答'}</span>{' '}
                      <span className="chip chip-green">正确:{d.question.answer}</span>
                    </div>
                    <p className="muted">{d.question.explanation}</p>
                  </li>
                ))}
            </ul>
          </>
        )}
        <a className="btn btn-primary w100 mt8" href="#/exam">
          <Icon name="refresh" size={14} /> 再来一套
        </a>
      </section>
    </div>
  )
}

// 今日学习:首页仪表盘(倒计时/任务/复习/时长/完成率/等级/薄弱点)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Mascot } from '../components/Mascot'
import { EmptyState, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { TaskRow, launchTask } from '../components/TaskRow'
import { generateTasks, firstUndoneTask } from '../lib/plan'
import { levelInfo } from '../lib/xp'
import { daysBetween, fmtDate, todayStr, weekdayCn, clockFmt } from '../lib/date'
import { dueWrongList, weakKps, getMastery } from '../lib/selectors'
import { startKpPractice, startWrongReview } from '../lib/practice'
import { nav } from '../lib/misc'
import { ELECTIVE_TEXT, EXAM_CATEGORIES } from '../lib/categories'

function Ring({ p }: { p: number }) {
  const r = 24
  const c = 2 * Math.PI * r
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`完成率 ${Math.round(p * 100)}%`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#E9EFF6" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${c * p} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--ink)">
        {Math.round(p * 100)}%
      </text>
    </svg>
  )
}

/** 学习计时器:本地计时,定期同步到 store(空转不计经验,防刷) */
function TimerCard() {
  const { state, dispatch } = useStore()
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState(0)
  const accRef = useRef(0)
  const date = todayStr()

  useEffect(() => {
    if (!running) return
    const iv = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(iv)
  }, [running])

  const flush = () => {
    if (accRef.current > 0) {
      dispatch({ type: 'ADD_STUDY_TIME', date, seconds: accRef.current })
      accRef.current = 0
    }
  }

  useEffect(() => {
    if (running && tick > 0) accRef.current += 1
    if (tick > 0 && tick % 15 === 0) flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  useEffect(() => {
    const h = () => flush()
    window.addEventListener('beforeunload', h)
    return () => {
      window.removeEventListener('beforeunload', h)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const todaySec = (state.studyTime[date] ?? 0) + accRef.current

  return (
    <div className="card">
      <div className="card-h">
        <span className="icon-chip">
          <Icon name="clock" size={15} />
        </span>
        <b>今日学习时长</b>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="num" style={{ fontSize: 26 }}>
          {clockFmt(todaySec)}
        </b>
        <button
          className={`btn ${running ? '' : 'btn-primary'}`}
          onClick={() => {
            if (running) flush()
            setRunning((r) => !r)
          }}
        >
          <Icon name={running ? 'pause' : 'play'} size={14} />
          {running ? '暂停' : '开始学习'}
        </button>
      </div>
      <p className="fs12 muted mt8">计时只是记录工具,经验值只与真实学习行为挂钩。</p>
    </div>
  )
}

export function Today() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const date = todayStr()
  const tasks = state.tasks[date] ?? []

  // 每天首次进入自动生成当日计划(保留已有,不覆盖)
  useEffect(() => {
    if (state.onboarded && state.profile && !(date in state.tasks)) {
      dispatch({ type: 'SET_TASKS', date, tasks: generateTasks(state, date) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, state.onboarded])

  const profile = state.profile
  const due = useMemo(() => dueWrongList(state, date), [state.wrong, date]) // eslint-disable-line react-hooks/exhaustive-deps
  const weak = useMemo(() => weakKps(state, 5), [state.kps, state.attempts]) // eslint-disable-line react-hooks/exhaustive-deps
  const level = levelInfo(state.xp)

  const doneCount = tasks.filter((t) => t.done).length
  const completion = tasks.length > 0 ? doneCount / tasks.length : 0
  const totalQuestions = tasks.reduce((s, t) => s + (t.questionCount || 0), 0)
  const answeredQuestions = tasks.reduce((s, t) => s + Math.min(t.progress, t.questionCount || 0), 0)

  const daysLeft = profile ? daysBetween(date, profile.examDate) : 0
  const hour = new Date().getHours()
  const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

  const lastActive = state.streak.lastActive
  const gapDays = lastActive ? daysBetween(lastActive, date) : null
  const welcome =
    gapDays != null && gapDays >= 2
      ? '欢迎回来,今天从一个小任务重新开始。'
      : tasks.length > 0 && doneCount < tasks.length
        ? `今天有 ${tasks.length} 个任务,一步一步来就好。`
        : doneCount > 0 && doneCount === tasks.length && tasks.length > 0
          ? '今日任务全部完成,休息一下也不错!'
          : '在左侧安排科目后,这里会显示你的每日任务。'

  const mood = tasks.length > 0 && doneCount === tasks.length ? 'happy' : due.length > 0 ? 'remind' : 'idle'
  const nextTask = firstUndoneTask(tasks)

  const resumeOrStart = () => {
    if (state.session) {
      nav('practice')
      return
    }
    if (state.lastSummary && state.lastSummary.wrongKpIds.length > 0) {
      const s = startKpPractice(state, state.lastSummary.wrongKpIds[0], 8)
      if (s) {
        dispatch({ type: 'START_SESSION', session: s })
        nav('practice')
        return
      }
    }
    if (nextTask) {
      launchTask(state, dispatch, toast, nextTask)
    } else {
      toast('今天的任务都完成啦,可以去错题本或题库自由练习', { kind: 'success' })
    }
  }

  if (!profile) return <EmptyState title="还没有备考资料" desc="请先完成角色创建" />

  const practiceTotal = tasks.reduce((s, t) => s + (t.type !== 'learnKP' ? t.questionCount : 0), 0)

  return (
    <div>
      <section className="hero">
        <div className="hero-top">
          {state.settings.mascotEnabled && <Mascot mood={mood} size={62} bubble={welcome} />}
          <div className="grow">
            <h2>
              {greet},{profile.nickname}
            </h2>
            <div className="fs13 muted">
              {fmtDate(date)} {weekdayCn(date)} · {profile.major} ·{' '}
              {profile.category ? `${EXAM_CATEGORIES[profile.category].name}(${EXAM_CATEGORIES[profile.category].math})` : '未选类别'} ·{' '}
              {ELECTIVE_TEXT[profile.elective ?? 'english']} · {profile.syllabusYear} 年大纲
              {profile.targetCollege && <> · 目标:{profile.targetCollege}</>}
            </div>
          </div>
          <div className="hero-side">
            <span className="countdown">
              <Icon name="flag" size={15} />
              <span className="big num">{daysLeft > 0 ? daysLeft : 0}</span>
              {daysLeft > 0 ? '天后考试' : daysLeft === 0 ? '今天考试,加油!' : '考试已结束'}
            </span>
            <span className="level-chip">
              <Icon name="cap" size={14} /> Lv.{level.level} {level.title}
            </span>
          </div>
        </div>
      </section>

      {(state.session || nextTask) && (
        <div className="row mb12" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-soft" onClick={resumeOrStart}>
            <Icon name="play" size={14} />
            {state.session
              ? `继续上次学习(${Object.keys(state.session.answers).length}/${state.session.questionIds.length})`
              : '开始今日第一个任务'}
          </button>
        </div>
      )}

      <div className="grid2">
        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="list" size={15} />
              </span>
              <b>今日学习任务</b>
              <div className="right">
                <span className="fs12 muted num">
                  {doneCount}/{tasks.length} 项
                </span>
              </div>
            </div>
            {tasks.length === 0 ? (
              <EmptyState
                mood="idle"
                title="今天还没有任务"
                desc="去「学习计划」重新生成,或在「知识校园」中添加科目和知识点,我就能帮你安排了。"
              />
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
            <div className="row mt12 fs12 muted">
              <Icon name="refresh" size={13} />
              没完成的任务会在明天温和地重新安排,不扣经验、不清空连续记录。
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="flag" size={15} />
              </span>
              <b>今日学习排名</b>
              <div className="right fs12 muted">本机账号 · 友谊赛</div>
            </div>
            <p className="fs13 muted">看看今天谁是校园里最勤奋的冒险者(题数 · 时长 · 经验)。</p>
            <button
              className="btn btn-primary w100 mt8"
              onClick={() => {
                const url = window.location.origin + window.location.pathname + '#/rank'
                const w = window.open(url, 'zsb-rank', 'width=620,height=860')
                if (!w) nav('rank')
              }}
            >
              <Icon name="arrowRight" size={14} /> 打开排名窗口
            </button>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="target" size={15} />
              </span>
              <b>今日完成率</b>
            </div>
            <div className="ring-box">
              <Ring p={completion} />
              <div className="grow">
                <div className="stat-line">
                  <span>任务</span>
                  <b className="num">
                    {doneCount}/{tasks.length}
                  </b>
                </div>
                <div className="stat-line">
                  <span>题目</span>
                  <b className="num">
                    {answeredQuestions}/{practiceTotal}
                  </b>
                </div>
              </div>
            </div>
          </div>

          <TimerCard />

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="zap" size={15} />
              </span>
              <b>经验与等级</b>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="fs13">
                Lv.{level.level} {level.title}
              </span>
              <span className="fs12 muted num">
                {state.xp - level.curBase}/{level.nextNeed - level.curBase}
              </span>
            </div>
            <div className="xp-bar mt8">
              <i style={{ width: `${Math.round(level.progress * 100)}%` }} />
            </div>
            <p className="fs12 muted mt8">
              经验来自完成任务、有效练习、错题复习和掌握新知识点;装扮奖励只改变外观。
            </p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
                <Icon name="wrongbook" size={15} />
              </span>
              <b>到期错题</b>
              <div className="right">
                <button className="btn btn-sm" onClick={() => nav('wrong')}>
                  管理
                </button>
              </div>
            </div>
            {due.length === 0 ? (
              <p className="fs13 muted">今天没有到期的错题,保持节奏就好。</p>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="fs13">
                  <b className="num" style={{ color: 'var(--coral-deep)' }}>
                    {due.length}
                  </b>{' '}
                  道错题到了复习时间
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    const s = startWrongReview(state)
                    if (!s) {
                      toast('错题本为空')
                      return
                    }
                    dispatch({ type: 'START_SESSION', session: s })
                    nav('practice')
                  }}
                >
                  去复习
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
                <Icon name="fire" size={15} />
              </span>
              <b>最近的薄弱知识点</b>
              <div className="right">
                <button className="btn btn-sm" onClick={() => nav('stats')}>
                  全部
                </button>
              </div>
            </div>
            {weak.length === 0 ? (
              <p className="fs13 muted">先去练习几道题,我才能帮你找出薄弱点。</p>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {weak.map((k) => {
                  const m = getMastery(state, k)
                  const subject = state.subjects.find((s) => s.id === k.subjectId)
                  return (
                    <div key={k.id} className="row">
                      <span className="dot" style={{ background: subject?.color ?? '#999' }} />
                      <span className="grow fs13" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {k.name}
                      </span>
                      <span className={`chip ${m == null ? '' : m < 60 ? 'chip-red' : m < 80 ? 'chip-yellow' : 'chip-green'} num`}>
                        {m == null ? '数据不足' : `${m}%`}
                      </span>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          const s = startKpPractice(state, k.id, 6)
                          if (!s) {
                            toast('该知识点暂无题目', { kind: 'error' })
                            return
                          }
                          dispatch({ type: 'START_SESSION', session: s })
                          nav('practice')
                        }}
                      >
                        练一练
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

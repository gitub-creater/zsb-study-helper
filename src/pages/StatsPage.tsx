// 数据分析(第一阶段基础版):总览 / 科目章节掌握度 / 薄弱排行 / 近7天趋势
import React, { useMemo } from 'react'
import { useStore } from '../store/store'
import { Bar, Chip, EmptyState, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { chapterKps, chapterMastery, getMastery, subjectMastery, subjectAccuracy, totalAccuracy, weakKps } from '../lib/selectors'
import { totalReviewCount } from '../lib/spaced'
import { masteryTone } from '../lib/mastery'
import { startKpPractice } from '../lib/practice'
import { addDays, fmtDuration, fmtDate, todayStr } from '../lib/date'
import { nav } from '../lib/misc'
import { levelInfo } from '../lib/xp'

export function StatsPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const today = todayStr()

  const totalAcc = totalAccuracy(state)
  const weak = useMemo(() => weakKps(state, 10), [state.kps, state.attempts]) // eslint-disable-line react-hooks/exhaustive-deps
  const dueCount = Object.values(state.wrong).filter((e) => !e.archived && e.nextReviewAt != null && e.nextReviewAt <= today).length

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, -6 + i)
      const attempts = state.attempts.filter((a) => a.date === d).length
      const sec = state.studyTime[d] ?? 0
      return { date: d, attempts, sec }
    })
  }, [state.attempts, state.studyTime, today])
  const maxAtt = Math.max(1, ...days.map((d) => d.attempts))

  if (!state.profile) return <EmptyState title="请先完成角色创建" />

  const totalMin = Object.values(state.studyTime).reduce((s, v) => s + v, 0)
  const level = levelInfo(state.xp)

  return (
    <div>
      <div className="page-h">
        <h2>数据分析</h2>
        <span className="fs12 muted">学习数据与游戏化数据分开统计,等级不代替真实水平</span>
      </div>

      <div className="cards mb12">
        <div className="card">
          <div className="fs12 muted">累计练习</div>
          <b className="num" style={{ fontSize: 24 }}>{state.attempts.length}</b>
          <div className="fs12 muted">题</div>
        </div>
        <div className="card">
          <div className="fs12 muted">总正确率</div>
          <b className="num" style={{ fontSize: 24, color: 'var(--green-deep)' }}>{totalAcc == null ? '—' : `${Math.round(totalAcc * 100)}%`}</b>
          <div className="fs12 muted">{totalAcc == null ? '做几道题就有数据啦' : '全部作答的平均值'}</div>
        </div>
        <div className="card">
          <div className="fs12 muted">待复习错题</div>
          <b className="num" style={{ fontSize: 24, color: dueCount > 0 ? 'var(--coral-deep)' : 'var(--ink)' }}>{dueCount}</b>
          <div className="fs12 muted">累计复习 {totalReviewCount(state.wrong)} 次</div>
        </div>
        <div className="card">
          <div className="fs12 muted">累计学习时长</div>
          <b className="num" style={{ fontSize: 24 }}>{totalMin < 60 ? `${Math.round(totalMin / 60)} 分` : fmtDuration(totalMin)}</b>
          <div className="fs12 muted">连续学习 {state.streak.current} 天(最佳 {state.streak.best})</div>
        </div>
      </div>

      <div className="grid2">
        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="chart" size={15} />
              </span>
              <b>科目与章节掌握度</b>
            </div>
            {state.subjects.length === 0 ? (
              <p className="fs13 muted">先添加科目和知识点。</p>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                {state.subjects.map((s) => {
                  const sm = subjectMastery(state, s.id)
                  const chs = state.chapters.filter((c) => c.subjectId === s.id).sort((a, b) => a.order - b.order)
                  return (
                    <div key={s.id}>
                      <div className="row mb8">
                        <span className="dot" style={{ background: s.color }} />
                        <b className="fs13">{s.name}</b>
                        <span className="fs12 muted num">
                          目标 {s.targetScore} 分 · 练习正确率 {subjectAccuracy(state, s.id) == null ? '—' : `${Math.round(subjectAccuracy(state, s.id)! * 100)}%`}
                        </span>
                      </div>
                      <div className="bar-row mb8">
                        <span className="lbl">科目总体</span>
                        <Bar value={sm} tone={masteryTone(sm)} />
                        <span className="val num">{sm == null ? '—' : `${sm}%`}</span>
                      </div>
                      {chs.map((c) => {
                        const cm = chapterMastery(state, c.id)
                        return (
                          <div key={c.id} className="bar-row" style={{ marginBottom: 6 }}>
                            <span className="lbl" style={{ paddingLeft: 12 }}>{c.name}</span>
                            <Bar value={cm} tone={masteryTone(cm)} />
                            <span className="val num">{cm == null ? '—' : `${cm}%`}</span>
                          </div>
                        )
                      })}
                      {chs.every((c) => chapterKps(state, c.id).length === 0) && (
                        <p className="fs12 muted">该科目还没有知识点,掌握度将在练习后出现。</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="calendar" size={15} />
              </span>
              <b>最近 7 天练习量</b>
            </div>
            <div className="trend">
              {days.map((d) => (
                <div key={d.date} className="col-bar" title={`${fmtDate(d.date)}:${d.attempts} 题 · ${fmtDuration(d.sec)}`}>
                  <span className="fs12 num" style={{ color: d.attempts > 0 ? 'var(--primary-deep)' : 'var(--ink-3)' }}>
                    {d.attempts || ''}
                  </span>
                  <div className="stick" style={{ height: `${(d.attempts / maxAtt) * 70}px`, opacity: d.attempts > 0 ? 1 : 0.25 }} />
                  <span className="lbl num">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <p className="fs12 muted mt8">柱子越高代表当天练习题越多;悬停可看当日时长。最近 30 天趋势图将在第二阶段加入。</p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="zap" size={15} />
              </span>
              <b>模拟考试成绩变化</b>
              <div className="right">
                <Chip>第二阶段开放</Chip>
              </div>
            </div>
            <p className="fs13 muted">完成第一、二阶段的练习后,这里会展示历次模拟考与阶段测试的分数走势。</p>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
                <Icon name="fire" size={15} />
              </span>
              <b>薄弱知识点排行</b>
            </div>
            {weak.length === 0 ? (
              <p className="fs13 muted">练习之后,这里会列出最需要优先巩固的知识点。</p>
            ) : (
              <div className="col" style={{ gap: 9 }}>
                {weak.map((k, i) => {
                  const m = getMastery(state, k)
                  const subject = state.subjects.find((s) => s.id === k.subjectId)
                  return (
                    <div key={k.id} className="row">
                      <span className="fs12 muted num" style={{ width: 16 }}>{i + 1}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="fs13" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {k.name} <span className="muted fs12">· {subject?.name}</span>
                        </div>
                        <div className="bar-row mt8" style={{ marginTop: 4 }}>
                          <Bar value={m} tone={masteryTone(m)} />
                        </div>
                      </div>
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
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="cap" size={15} />
              </span>
              <b>游戏化数据(仅供激励)</b>
            </div>
            <div className="stat-line">
              <span>角色等级</span>
              <b>Lv.{level.level} {level.title}</b>
            </div>
            <div className="stat-line">
              <span>累计经验</span>
              <b className="num">{state.xp}</b>
            </div>
            <div className="stat-line">
              <span>已掌握知识点</span>
              <b className="num">{state.kps.filter((k) => k.status === 'mastered').length}</b>
            </div>
            <p className="fs12 muted mt8">等级和徽章只是学习行为的纪念,上面的掌握度才是真实水平。</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// 学习计划:今日任务管理(排序/调量/顺延)与重新生成
import React, { useEffect } from 'react'
import { useStore } from '../store/store'
import { TaskRow } from '../components/TaskRow'
import { EmptyState, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { generateTasks, regenerateTasks } from '../lib/plan'
import { daysBetween, fmtDate, todayStr, weekdayCn } from '../lib/date'

export function PlanPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()
  const date = todayStr()
  const tasks = state.tasks[date] ?? []

  useEffect(() => {
    if (state.onboarded && state.profile && !(date in state.tasks)) {
      dispatch({ type: 'SET_TASKS', date, tasks: generateTasks(state, date) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, state.onboarded])

  if (!state.profile) return <EmptyState title="请先完成角色创建" />

  const p = state.profile
  const daysLeft = daysBetween(date, p.examDate)

  return (
    <div>
      <div className="page-h">
        <h2>学习计划</h2>
        <span className="chip chip-blue num">{fmtDate(date)} {weekdayCn(date)}</span>
        <span className="chip num">距考试 {Math.max(0, daysLeft)} 天</span>
        <div className="spacer" />
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirm({
              title: '重新生成今日计划?',
              desc: '已完成的任务和学习记录会完整保留,只重新安排未完成的部分。',
              confirmText: '重新生成',
            })
            if (ok) {
              dispatch({ type: 'SET_TASKS', date, tasks: regenerateTasks(state, date) })
              toast('已重新生成,已完成任务不受影响', { kind: 'success' })
            }
          }}
        >
          <Icon name="refresh" size={14} /> 重新生成
        </button>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-h">
            <span className="icon-chip">
              <Icon name="calendar" size={15} />
            </span>
            <b>今日任务({tasks.length})</b>
            <div className="right fs12 muted">可排序、调量、顺延</div>
          </div>
          {tasks.length === 0 ? (
            <EmptyState
              mood="idle"
              title="今天没有安排任务"
              desc="点右上角「重新生成」;若科目和知识点为空,请先到「知识校园 → 列表管理」添加。"
            />
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} mode="plan" />
              ))}
            </div>
          )}
        </div>

        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="sparkle" size={15} />
              </span>
              <b>计划是如何生成的</b>
            </div>
            <ul className="fs13" style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
              <li>优先安排<b>到期的错题复习</b>(间隔复习优先级最高)</li>
              <li>按「距考试天数 × 每周学习天数」推算每日新课节奏</li>
              <li>薄弱科目、掌握度低的知识点优先安排</li>
              <li>最近正确率低于 60% 时,自动减少新课、多安排巩固</li>
              <li>每满 7 天安排一次阶段小测</li>
              <li>非学习日只保留复习任务,温和推进</li>
            </ul>
          </div>
          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--green-weak)', color: 'var(--green-deep)' }}>
                <Icon name="check" size={15} />
              </span>
              <b>完不成怎么办</b>
            </div>
            <p className="fs13" style={{ lineHeight: 1.9 }}>
              顺延到明天就好,不会扣经验、不会清空连续记录,也不会有小怪兽来催你。
              <br />
              计划是工具,不是考官 —— 按自己的节奏来。
            </p>
          </div>
          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="clock" size={15} />
              </span>
              <b>今日预算</b>
            </div>
            <div className="stat-line">
              <span>每天可用时间</span>
              <b className="num">{p.dailyMinutes} 分钟</b>
            </div>
            <div className="stat-line">
              <span>任务预计总时长</span>
              <b className="num">{tasks.reduce((s, t) => s + t.estMinutes, 0)} 分钟</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

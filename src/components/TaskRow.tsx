// 每日任务行:今日页与学习计划页共用
import React from 'react'
import type { Task } from '../types'
import { TASK_TYPE_TEXT } from '../types'
import { useStore } from '../store/store'
import { useToast } from './ui'
import { Icon } from './Icon'
import { Stepper } from './ui'
import { nav } from '../lib/misc'
import { startKpPractice, startPracticeFromTask } from '../lib/practice'

export function launchTask(
  state: ReturnType<typeof useStore>['state'],
  dispatch: ReturnType<typeof useStore>['dispatch'],
  toast: ReturnType<typeof useToast>,
  task: Task
): void {
  const s = startPracticeFromTask(state, task)
  if (!s) {
    toast('暂时没有可练习的题目,可先在题库中补充,或直接手动标记完成', { kind: 'error' })
    return
  }
  dispatch({ type: 'START_SESSION', session: s })
  nav('practice')
}

export function TaskRow({ task, mode = 'today' }: { task: Task; mode?: 'today' | 'plan' }) {
  const { state, dispatch } = useStore()
  const toast = useToast()

  const toggleDone = () => {
    if (!task.done) {
      dispatch({ type: 'UPDATE_TASK', date: new Date().toISOString().slice(0, 10), taskId: task.id, patch: { done: true } })
      toast(`任务完成 +${task.xp} 经验`, { kind: 'success' })
    } else {
      dispatch({ type: 'UPDATE_TASK', date: new Date().toISOString().slice(0, 10), taskId: task.id, patch: { done: false } })
      toast('已取消完成(经验不回收,随时重新开始)')
    }
  }

  const start = () => launchTask(state, dispatch, toast, task)

  const practiceKp = () => {
    const ids = task.kpIds ?? []
    const s = startKpPractice(state, ids[0] ?? '', 8)
    if (!s) {
      toast('该知识点暂无题目,可在题库中补充', { kind: 'error' })
      return
    }
    dispatch({ type: 'START_SESSION', session: s })
    nav('practice')
  }

  const practiceType = task.type === 'chapterPractice' || task.type === 'reviewWrong' || task.type === 'stageTest'

  return (
    <div className={`task${task.done ? ' done' : ''}`}>
      <button className="tick" onClick={toggleDone} aria-label={task.done ? '取消完成' : '标记完成'}>
        <Icon name="check" size={13} />
      </button>
      <div className="grow">
        <div className="t-title">{task.title}</div>
        <div className="t-meta">
          <span className="chip">{TASK_TYPE_TEXT[task.type]}</span>
          {practiceType && task.questionCount > 0 && (
            <span className="chip chip-blue num">
              {task.progress}/{task.questionCount} 题
            </span>
          )}
          {task.type === 'learnKP' && task.done && <span className="chip chip-green">已学习</span>}
          <span className="chip chip-yellow">+{task.xp} 经验</span>
          <span className="chip">约 {task.estMinutes} 分钟</span>
        </div>
      </div>
      <div className="t-actions">
        {mode === 'plan' && practiceType && !task.done && (
          <Stepper value={task.questionCount} min={1} max={50} onChange={(v) => dispatch({ type: 'UPDATE_TASK', date: new Date().toISOString().slice(0, 10), taskId: task.id, patch: { questionCount: v } })} />
        )}
        {mode === 'plan' && !task.done && (
          <>
            <button className="mini-btn" aria-label="上移" onClick={() => dispatch({ type: 'MOVE_TASK', date: new Date().toISOString().slice(0, 10), taskId: task.id, dir: -1 })}>
              <Icon name="up" size={13} />
            </button>
            <button className="mini-btn" aria-label="下移" onClick={() => dispatch({ type: 'MOVE_TASK', date: new Date().toISOString().slice(0, 10), taskId: task.id, dir: 1 })}>
              <Icon name="down" size={13} />
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                dispatch({ type: 'POSTPONE_TASK', date: new Date().toISOString().slice(0, 10), taskId: task.id })
                toast('已顺延到明天,不扣经验、不断连续记录')
              }}
            >
              顺延
            </button>
          </>
        )}
        {!task.done && practiceType && (
          <button className="btn btn-sm btn-primary" onClick={start}>
            开始
          </button>
        )}
        {!task.done && task.type === 'learnKP' && (
          <>
            <button className="btn btn-sm" onClick={practiceKp}>
              去练一练
            </button>
          </>
        )}
      </div>
    </div>
  )
}

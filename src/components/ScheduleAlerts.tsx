// 已安排任务的全局调度器:定时检查到点任务,弹应用内提醒 + 系统通知
// 挂载在应用根节点,任何页面都能收到提醒;一次只弹一条,处理完再看下一条
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Modal } from './ui'
import { Icon } from './Icon'
import { useToast } from './ui'
import { nav } from '../lib/misc'
import { SNOOZE_MINUTES, fireAt, isDue } from '../lib/schedule'
import type { ScheduleTask } from '../types'

/** 页面里的「测试提醒」按钮通过这个事件请求弹出提醒 */
export const SCHEDULE_TEST_EVENT = 'zsb-schedule-test'

export function requestScheduleTest(taskId: string): void {
  window.dispatchEvent(new CustomEvent(SCHEDULE_TEST_EVENT, { detail: taskId }))
}

function sendSystemNotification(title: string, body: string, tag: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const n = new Notification(title, { body, tag })
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        // 忽略
      }
    }
  } catch {
    // 通知构造失败不影响应用内弹窗
  }
}

interface AlertState {
  taskId: string
  /** 发生时刻(本地 YYYY-MM-DDTHH:MM) */
  key: string
  /** 测试提醒不写历史、不改计划 */
  test?: boolean
}

export function ScheduleAlerts() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [alert, setAlert] = useState<AlertState | null>(null)
  const alertRef = useRef(alert)
  alertRef.current = alert
  const stateRef = useRef(state)
  stateRef.current = state

  const findTask = (list: ScheduleTask[], id: string): ScheduleTask | undefined => list.find((t) => t.id === id)

  const tick = useCallback(() => {
    // 已有弹窗未处理时不重复弹(处理完下一轮自动接上)
    if (alertRef.current) return
    const s = stateRef.current
    const now = new Date()
    for (const t of s.schedules ?? []) {
      if (!t.enabled) continue
      // 稍后提醒中:到点再弹,期间不检查常规到期(避免双弹)
      if (t.snoozed) {
        if (now.getTime() >= new Date(t.snoozed.until).getTime()) {
          setAlert({ taskId: t.id, key: t.snoozed.key })
          return
        }
        continue
      }
      if (isDue(t, now)) {
        setAlert({ taskId: t.id, key: t.nextRunAt! })
        return
      }
    }
  }, [])

  // 挂载立即检查(覆盖"软件没开着,错过之后才启动"的场景:迟到的任务依然会弹)
  useEffect(() => {
    tick()
    const timer = window.setInterval(tick, 20000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [tick])

  // 测试提醒
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const t = findTask(stateRef.current.schedules ?? [], id)
      if (!t) return
      setAlert({ taskId: id, key: t.nextRunAt ?? `${new Date().toISOString().slice(0, 10)}T${t.time}`, test: true })
    }
    window.addEventListener(SCHEDULE_TEST_EVENT, h)
    return () => window.removeEventListener(SCHEDULE_TEST_EVENT, h)
  }, [])

  const task = alert ? findTask(state.schedules ?? [], alert.taskId) : undefined

  // 弹窗出现时发系统通知
  useEffect(() => {
    if (!alert || !task) return
    const body = task.note ? `${task.note}` : '到时间了,开始学习吧'
    sendSystemNotification(`学习提醒:${task.name}`, body, alert.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.taskId, alert?.key])

  const closeAndRecord = () => {
    if (!alert) return
    if (!alert.test) dispatch({ type: 'SCHEDULE_NOTIFIED', id: alert.taskId, key: alert.key })
    setAlert(null)
  }

  const onStart = () => {
    closeAndRecord()
    nav('#/plan')
  }

  const onSnooze = () => {
    if (!alert) return
    if (!alert.test) {
      dispatch({
        type: 'SCHEDULE_SNOOZE',
        id: alert.taskId,
        key: alert.key,
        until: new Date(Date.now() + SNOOZE_MINUTES * 60000).toISOString(),
      })
    }
    setAlert(null)
  }

  const onDone = () => {
    if (!alert) return
    if (!alert.test) dispatch({ type: 'SCHEDULE_DONE', id: alert.taskId, key: alert.key })
    else toast('这是测试提醒,任务计划没有改动', { kind: 'info' })
    setAlert(null)
  }

  if (!alert || !task) return null

  const planned = alert.key.split('T')[1] ?? task.time
  const lateMin = Math.max(0, Math.round((Date.now() - fireAt(alert.key, task.remindBefore).getTime()) / 60000))

  return (
    <Modal
      open
      title={alert.test ? '测试提醒' : '学习提醒'}
      onClose={alert.test ? () => setAlert(null) : closeAndRecord}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onSnooze}>
            稍后提醒
          </button>
          <button className="btn" onClick={onDone}>
            <Icon name="check" size={14} /> 标记完成
          </button>
          <button className="btn btn-primary" onClick={onStart}>
            <Icon name="play" size={14} /> 开始学习
          </button>
        </>
      }
    >
      <div className="sched-alert">
        <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
          <Icon name="timer" size={20} />
        </span>
        <b className="sched-alert-name">{task.name}</b>
        {task.note && <p className="muted" style={{ margin: 0 }}>{task.note}</p>}
        <div className="col" style={{ gap: 4 }}>
          <span className="fs13 muted">
            计划时间 {planned}
            {task.remindBefore > 0 ? `(提前 ${task.remindBefore} 分钟)` : ''}
          </span>
          {!alert.test && lateMin >= 1 && <span className="chip chip-yellow">软件没开着,这条提醒迟到了约 {lateMin} 分钟</span>}
          {alert.test && <span className="chip chip-blue">测试提醒,任务计划不会改动</span>}
        </div>
      </div>
    </Modal>
  )
}

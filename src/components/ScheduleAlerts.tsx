// 全局调度器：定时检查到点任务，弹应用内提醒、系统通知与可选语音。
// 网页/桌面/手机应用未运行时没有可靠的 JS 调度与后台语音能力，页面会明确提示该限制。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Modal, useToast } from './ui'
import { Icon } from './Icon'
import { nav } from '../lib/misc'
import {
  SNOOZE_MINUTES,
  fireAt,
  hasStaleScheduleOccurrence,
  isDue,
  localStamp,
  scheduleAdvanceMinutes,
  scheduleContent,
  scheduleNotificationEnabled,
  scheduleReminderSound,
  scheduleTitle,
  scheduleVoiceEnabled,
} from '../lib/schedule'
import type { ScheduleTask } from '../types'
import { BrowserSpeechController } from '../services/tts'
import { syncNativeScheduleNotifications } from '../services/nativeScheduleNotifications'
import { emitPetEvent } from '../lib/pet'

/** 页面里的“测试提醒”按钮通过这个事件请求弹出提醒。 */
export const SCHEDULE_TEST_EVENT = 'zsb-schedule-test'

export type ScheduleNotificationPermission = NotificationPermission | 'unsupported'

/** 读取当前环境的通知授权状态，供页面提示和测试共用。 */
export function scheduleNotificationPermission(): ScheduleNotificationPermission {
  return typeof window === 'undefined' || typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export function requestScheduleTest(taskId: string, skipAudio = false): void {
  window.dispatchEvent(new CustomEvent(SCHEDULE_TEST_EVENT, { detail: { taskId, skipAudio } }))
}

function findTask(list: ScheduleTask[], id: string): ScheduleTask | undefined {
  return list.find((task) => task.id === id)
}

/** 提醒朗读文本单独导出，便于不依赖浏览器语音环境的单元测试。 */
export function reminderSpeechText(task: ScheduleTask): string {
  const title = scheduleTitle(task)
  const content = scheduleContent(task)
  return content ? `学习提醒。${title}。任务内容：${content}` : `学习提醒。${title}。到时间了，请开始学习。`
}

export function canSendScheduleSystemNotification(task: ScheduleTask, permission = scheduleNotificationPermission()): boolean {
  return scheduleNotificationEnabled(task) && permission === 'granted'
}

/** 全局语音总开关与单任务开关必须同时开启，任务提醒才允许朗读。 */
export function canSpeakScheduleReminder(task: ScheduleTask, globalSpeechEnabled: boolean): boolean {
  return globalSpeechEnabled && scheduleVoiceEnabled(task)
}

function sendSystemNotification(task: ScheduleTask, key: string): void {
  try {
    if (!canSendScheduleSystemNotification(task) || typeof Notification === 'undefined') return
    const notification = new Notification(`学习提醒：${scheduleTitle(task)}`, {
      body: scheduleContent(task) || '到时间了，开始学习吧',
      tag: `zsb-reminder-${task.id}-${key}`,
    })
    notification.onclick = () => {
      try {
        window.focus()
        nav('scheduled')
      } catch {
        // 系统通知点击失败不影响应用内提醒。
      }
    }
  } catch {
    // 通知构造失败不影响应用内弹窗。
  }
}

type StopAudio = () => void

/**
 * 只用 Web Audio API 实时合成两声短提示，不引用、下载或内置第三方音频文件。
 * 某些浏览器要求用户手势才能播放；失败时返回空清理函数，提醒弹窗仍会正常显示。
 */
export function playReminderChime(): StopAudio {
  try {
    const AudioContextCtor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return () => {}
    const context = new AudioContextCtor()
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.connect(context.destination)
    const oscillators: OscillatorNode[] = []
    ;[0, 0.22].forEach((offset, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(index === 0 ? 660 : 880, context.currentTime + offset)
      oscillator.connect(gain)
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.17)
      oscillator.start(context.currentTime + offset)
      oscillator.stop(context.currentTime + offset + 0.19)
      oscillators.push(oscillator)
    })
    const timer = window.setTimeout(() => void context.close().catch(() => {}), 520)
    return () => {
      window.clearTimeout(timer)
      for (const oscillator of oscillators) {
        try {
          oscillator.stop()
        } catch {
          // 已停止的 oscillator 再次 stop 会抛错，忽略即可。
        }
      }
      void context.close().catch(() => {})
    }
  } catch {
    return () => {}
  }
}

interface AlertState {
  taskId: string
  /** 发生时刻（北京时间 YYYY-MM-DDTHH:MM）。 */
  key: string
  /** 测试提醒不写历史、不改计划。 */
  test?: boolean
  /** 已由点击手势直接播放过声音，弹窗只展示文字，避免重复且绕开自动播放拦截。 */
  skipAudio?: boolean
}

export function ScheduleAlerts() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [alert, setAlert] = useState<AlertState | null>(null)
  const [audioIssue, setAudioIssue] = useState<string | null>(null)
  const [audioActive, setAudioActive] = useState(false)
  const [audioVersion, setAudioVersion] = useState(0)
  const alertRef = useRef(alert)
  const stateRef = useRef(state)
  const speechRef = useRef<BrowserSpeechController | null>(null)
  const chimeStopRef = useRef<StopAudio | null>(null)
  alertRef.current = alert
  stateRef.current = state

  const stopAudio = useCallback(() => {
    chimeStopRef.current?.()
    chimeStopRef.current = null
    speechRef.current?.stop()
    setAudioActive(false)
  }, [])

  // 语音控制器只创建一次；状态留在组件中，关闭提醒或卸载时立刻停止朗读。
  useEffect(() => {
    const controller = new BrowserSpeechController({
      onStateChange: (playback) => setAudioActive(playback === 'speaking' || playback === 'paused'),
      onError: (message) => {
        setAudioIssue(message)
        setAudioActive(false)
      },
    })
    speechRef.current = controller
    return () => {
      chimeStopRef.current?.()
      chimeStopRef.current = null
      controller.dispose()
      speechRef.current = null
    }
  }, [])

  const tick = useCallback(() => {
    // 已有弹窗未处理时不重复弹；处理完下一轮自动接上。
    if (alertRef.current) return
    const now = new Date()
    for (const task of stateRef.current.schedules ?? []) {
      if (!task.enabled) continue
      // 稍后提醒中：到点再弹，期间不检查常规到期，避免双弹。
      if (task.snoozed) {
        if (now.getTime() >= new Date(task.snoozed.until).getTime()) {
          setAlert({ taskId: task.id, key: task.snoozed.key })
          return
        }
        continue
      }
      if (hasStaleScheduleOccurrence(task, now)) {
        dispatch({ type: 'SCHEDULE_SKIP_STALE', id: task.id, now: now.toISOString() })
        continue
      }
      if (isDue(task, now)) {
        setAlert({ taskId: task.id, key: task.nextRunAt! })
        return
      }
    }
  }, [])

  // 挂载立即检查，覆盖应用没开着而错过后才启动的场景：迟到的任务仍会弹。
  useEffect(() => {
    tick()
    const timer = window.setInterval(tick, 20000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [tick])

  // 页面“测试提醒”按钮：测试不会改动任务历史和下次时间。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string | { taskId?: string; skipAudio?: boolean }>).detail
      const id = typeof detail === 'string' ? detail : detail?.taskId
      if (!id) return
      const task = findTask(stateRef.current.schedules ?? [], id)
      if (!task) return
      setAlert({
        taskId: id,
        key: task.nextRunAt ?? `${localStamp(new Date()).slice(0, 10)}T${task.time}`,
        test: true,
        skipAudio: typeof detail === 'string' ? false : detail.skipAudio,
      })
    }
    window.addEventListener(SCHEDULE_TEST_EVENT, handler)
    return () => window.removeEventListener(SCHEDULE_TEST_EVENT, handler)
  }, [])

  const task = alert ? findTask(state.schedules ?? [], alert.taskId) : undefined
  const globalSpeechEnabled = state.settings.speech?.enabled !== false

  // Android 使用系统本地通知承接应用关闭后的提醒；网页/Electron 环境中该函数立即返回。
  // 任务、通知开关、语音总开关或重复计划变化时都会重新覆盖未来排程。
  useEffect(() => {
    void syncNativeScheduleNotifications(state.schedules ?? [], globalSpeechEnabled)
  }, [state.schedules, globalSpeechEnabled])

  // 弹窗出现时尝试系统通知,并同步喂给桌面宠物;宠物关闭时事件无人消费,无副作用。
  useEffect(() => {
    if (!alert || !task) return
    sendSystemNotification(task, alert.key)
    emitPetEvent({
      type: 'task',
      task: {
        taskId: task.id,
        taskKey: alert.key,
        name: scheduleTitle(task),
        content: scheduleContent(task),
        lateMinutes: Math.max(0, Math.round((Date.now() - fireAt(alert.key, scheduleAdvanceMinutes(task)).getTime()) / 60000)),
        test: alert.test,
      },
    })
  }, [alert?.taskId, alert?.key, alert?.test, task?.id, task?.notificationEnabled, task?.name, task?.note, task?.title, task?.content])

  // 声音在每次新提醒或用户点“再次播放”时启动；关闭、完成、稍后提醒均会停掉声音。
  useEffect(() => {
    stopAudio()
    setAudioIssue(null)
    if (!alert || !task || alert.skipAudio) return
    let usedAudio = false
    if (canSpeakScheduleReminder(task, globalSpeechEnabled)) {
      usedAudio = speechRef.current?.speak(reminderSpeechText(task), {
        rate: state.settings.speech?.rate ?? 1,
        voiceId: state.settings.speech?.voiceURI,
        voiceName: state.settings.speech?.voiceName,
      }) ?? false
    }
    if (scheduleReminderSound(task) === 'chime') {
      chimeStopRef.current = playReminderChime()
      usedAudio = true
    }
    if (usedAudio) setAudioActive(true)
    return stopAudio
  }, [
    alert?.taskId,
    alert?.key,
    alert?.skipAudio,
    task?.id,
    task?.voiceEnabled,
    task?.reminderSound,
    task?.name,
    task?.note,
    task?.title,
    task?.content,
    globalSpeechEnabled,
    state.settings.speech?.rate,
    state.settings.speech?.voiceURI,
    state.settings.speech?.voiceName,
    audioVersion,
    stopAudio,
  ])

  const closeAndRecord = () => {
    if (!alert) return
    stopAudio()
    if (!alert.test) dispatch({ type: 'SCHEDULE_NOTIFIED', id: alert.taskId, key: alert.key })
    else toast('这是测试提醒，任务计划没有改动', { kind: 'info' })
    setAlert(null)
  }

  const onStart = () => {
    closeAndRecord()
    nav('plan')
  }

  const onSnooze = () => {
    if (!alert) return
    stopAudio()
    if (!alert.test) {
      dispatch({
        type: 'SCHEDULE_SNOOZE',
        id: alert.taskId,
        key: alert.key,
        until: new Date(Date.now() + SNOOZE_MINUTES * 60000).toISOString(),
      })
    } else {
      toast('这是测试提醒，任务计划没有改动', { kind: 'info' })
    }
    setAlert(null)
  }

  const onDone = () => {
    if (!alert) return
    stopAudio()
    if (!alert.test) dispatch({ type: 'SCHEDULE_DONE', id: alert.taskId, key: alert.key })
    else toast('这是测试提醒，任务计划没有改动', { kind: 'info' })
    setAlert(null)
  }

  if (!alert || !task) return null

  const planned = alert.key.split('T')[1] ?? task.time
  const lateMinutes = Math.max(0, Math.round((Date.now() - fireAt(alert.key, scheduleAdvanceMinutes(task)).getTime()) / 60000))
  const voiceAllowed = canSpeakScheduleReminder(task, globalSpeechEnabled)
  const soundSummary = [voiceAllowed ? '语音播报' : '', scheduleReminderSound(task) === 'chime' ? '短提示音' : ''].filter(Boolean).join(' + ') || '静音'

  return (
    <Modal
      open
      title={alert.test ? '测试提醒' : '学习提醒'}
      onClose={closeAndRecord}
      width={440}
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <button className="btn" onClick={closeAndRecord}>
            关闭提醒
          </button>
          <button className="btn" onClick={onSnooze}>
            稍后提醒
          </button>
          <button className="btn" onClick={onDone}>
            <Icon name="check" size={14} /> 标记完成
          </button>
          <button className="btn btn-primary" onClick={onStart}>
            <Icon name="play" size={14} /> 开始学习
          </button>
        </div>
      }
    >
      <div className="sched-alert">
        <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
          <Icon name="timer" size={20} />
        </span>
        <b className="sched-alert-name">{scheduleTitle(task)}</b>
        {scheduleContent(task) && <p className="muted" style={{ margin: 0 }}>{scheduleContent(task)}</p>}
        <div className="col" style={{ gap: 4 }}>
          <span className="fs13 muted">
            计划时间 {planned}（北京时间）
            {scheduleAdvanceMinutes(task) > 0 ? `，提前 ${scheduleAdvanceMinutes(task)} 分钟` : ''}
          </span>
          <span className="fs13 muted">提醒声音：{soundSummary}</span>
          {!alert.test && lateMinutes >= 1 && <span className="chip chip-yellow">应用未运行时，这条提醒迟到了约 {lateMinutes} 分钟</span>}
          {alert.test && <span className="chip chip-blue">测试提醒，任务计划不会改动</span>}
        </div>
        {scheduleVoiceEnabled(task) && !globalSpeechEnabled && (
          <p className="fs12 muted" role="status" style={{ margin: 0 }}>
            全局语音功能已关闭。本次仍显示文字提醒；重新开启后可以使用语音播报。
          </p>
        )}
        {(voiceAllowed || scheduleReminderSound(task) === 'chime') && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => setAudioVersion((version) => version + 1)}>
              <Icon name="refresh" size={13} /> 再次播放声音
            </button>
            <button className="btn btn-sm" disabled={!audioActive} onClick={stopAudio}>
              <Icon name="stop" size={12} /> 停止声音
            </button>
          </div>
        )}
        {audioIssue && (
          <p className="fs12" role="status" style={{ margin: 0, color: 'var(--coral-deep)' }}>
            {audioIssue}
          </p>
        )}
      </div>
    </Modal>
  )
}

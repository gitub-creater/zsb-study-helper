// 已安排任务：创建、编辑、权限引导和历史记录。任务时刻统一按北京时间展示与保存。
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, EmptyState, Field, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { requestScheduleTest, scheduleNotificationPermission } from '../components/ScheduleAlerts'
import {
  nativeExactAlarmPermission,
  nativeScheduleNotificationPermission,
  requestNativeExactAlarmPermission,
  requestNativeScheduleNotificationPermission,
  showNativeScheduleTestNotification,
  supportsNativeScheduleNotifications,
  syncNativeScheduleNotifications,
} from '../services/nativeScheduleNotifications'
import {
  SCHEDULE_TIMEZONE,
  addScheduleDays,
  beijingTodayStr,
  makeScheduleTask,
  repeatText,
  scheduleAdvanceMinutes,
  scheduleContent,
  scheduleNotificationEnabled,
  scheduleReminderSound,
  scheduleRepeat,
  scheduleTitle,
  scheduleVoiceEnabled,
} from '../lib/schedule'
import type { ScheduleRepeat, ScheduleRun, ScheduleTask } from '../types'
import { fmtDate, fmtDateTime, weekdayCn } from '../lib/date'
import { uid } from '../lib/misc'

type FilterKind = 'all' | 'on' | 'off'
type FormKind = 'once' | 'daily' | 'weekly' | 'custom'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] // 与标签一一对应（周一…周日）

/** 下次执行时间的中文展示。 */
function fmtNext(stamp: string): string {
  const today = beijingTodayStr()
  if (stamp.startsWith(today)) return `今天 ${stamp.slice(11)}`
  if (stamp.startsWith(addScheduleDays(today, 1))) return `明天 ${stamp.slice(11)}`
  const [date, time] = stamp.split('T')
  return `${fmtDate(date)} ${time}`
}

function statusOf(task: ScheduleTask): 'on' | 'off' | 'ended' {
  if (!task.enabled) return 'off'
  return task.nextRunAt ? 'on' : 'ended'
}

function reminderSummary(task: ScheduleTask): string {
  const parts: string[] = []
  if (scheduleVoiceEnabled(task)) parts.push('语音播报')
  if (scheduleReminderSound(task) === 'chime') parts.push('短提示音')
  return parts.length > 0 ? parts.join(' + ') : '静音'
}

// ---------- 创建 / 编辑表单 ----------
function ScheduleForm({
  initial,
  onClose,
}: {
  initial: ScheduleTask | null
  onClose: () => void
}) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const existingRepeat = initial ? scheduleRepeat(initial) : null
  const [name, setName] = useState(initial ? scheduleTitle(initial) : '')
  const [note, setNote] = useState(initial ? scheduleContent(initial) : '')
  const [kind, setKind] = useState<FormKind>(existingRepeat?.kind ?? 'daily')
  const [date, setDate] = useState(initial?.date ?? beijingTodayStr())
  const [weekdays, setWeekdays] = useState<number[]>(existingRepeat?.kind === 'weekly' ? existingRepeat.weekdays : [1])
  const [intervalDays, setIntervalDays] = useState(existingRepeat?.kind === 'custom' ? Math.max(2, existingRepeat.intervalDays) : 2)
  const [time, setTime] = useState(initial?.time ?? '08:00')
  const [hasEnd, setHasEnd] = useState(initial?.endDate != null)
  const [endDate, setEndDate] = useState(initial?.endDate ?? addScheduleDays(beijingTodayStr(), 30))
  const [remind, setRemind] = useState(initial ? scheduleAdvanceMinutes(initial) : 0)
  const [afterDone, setAfterDone] = useState(initial?.afterDone ?? 'continue')
  // 新建任务默认明确开启语音；旧任务仍按原来的安静状态加载，不会因升级突然发声。
  const [voiceEnabled, setVoiceEnabled] = useState(initial ? scheduleVoiceEnabled(initial) : true)
  const [notificationEnabled, setNotificationEnabled] = useState(initial ? scheduleNotificationEnabled(initial) : true)
  const [reminderSound, setReminderSound] = useState<'chime' | 'silent'>(
    initial && scheduleReminderSound(initial) === 'chime' ? 'chime' : 'silent'
  )
  const [errs, setErrs] = useState<{ name?: string; weekdays?: string; endDate?: string; intervalDays?: string }>({})
  const globalSpeechEnabled = state.settings.speech?.enabled !== false

  const toggleWeekday = (weekday: number) => {
    setWeekdays((list) => (list.includes(weekday) ? list.filter((item) => item !== weekday) : [...list, weekday]))
  }

  const save = () => {
    const next: typeof errs = {}
    if (!name.trim()) next.name = '请填写任务名称'
    if (kind === 'weekly' && weekdays.length === 0) next.weekdays = '至少选择一个星期几'
    if (kind === 'custom' && (!Number.isInteger(intervalDays) || intervalDays < 2 || intervalDays > 365)) next.intervalDays = '请输入 2 到 365 之间的整数'
    if (kind !== 'once' && hasEnd && endDate && endDate < date) next.endDate = '结束日期不能早于开始日期'
    if (!time) next.name = next.name ?? '请选择执行时间'
    setErrs(next)
    if (Object.keys(next).length > 0) {
      toast('请先修改标红的选项再保存', { kind: 'error' })
      return
    }

    const repeat: ScheduleRepeat =
      kind === 'once'
        ? { kind: 'once' }
        : kind === 'daily'
          ? { kind: 'daily' }
          : kind === 'weekly'
            ? { kind: 'weekly', weekdays: [...weekdays].sort() }
            : { kind: 'custom', intervalDays }
    const title = name.trim()
    const content = note.trim()
    const common = {
      name: title,
      note: content,
      title,
      content,
      time,
      date,
      timezone: SCHEDULE_TIMEZONE,
      remindAt: `${date}T${time}`,
      repeat,
      repeatRule: repeat,
      endDate: kind !== 'once' && hasEnd ? endDate : undefined,
      remindBefore: remind,
      advanceMinutes: remind,
      afterDone,
      voiceEnabled,
      notificationEnabled,
      reminderSound,
      status: 'active' as const,
    }
    if (initial) {
      dispatch({ type: 'SCHEDULE_UPDATE', id: initial.id, patch: common })
      toast('已保存修改', { kind: 'success' })
    } else {
      dispatch({
        type: 'SCHEDULE_ADD',
        task: makeScheduleTask({ id: uid('sch'), ...common, enabled: true, nextRunAt: null }),
      })
      toast('已创建，到点会按北京时间提醒你', { kind: 'success' })
    }
    onClose()
  }

  return (
    <Modal
      open
      title={initial ? '编辑安排任务' : '新建安排任务'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            <Icon name="check" size={14} /> 保存
          </button>
        </>
      }
    >
      <Field label="任务名称" error={errs.name} hint="例如：背诵英语词汇">
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：背诵英语词汇" maxLength={30} autoFocus />
      </Field>
      <Field label="任务内容（可选）" hint="提醒弹窗和系统通知里会显示这段内容">
        <textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：Unit 3 单元词汇 20 个，边读边抄写" maxLength={120} />
      </Field>

      <Field label="重复规则" error={errs.weekdays ?? errs.intervalDays}>
        <Segmented
          value={kind}
          onChange={(value) => setKind(value)}
          options={[
            { value: 'once', label: '只执行一次' },
            { value: 'daily', label: '每天' },
            { value: 'weekly', label: '每周' },
            { value: 'custom', label: '自定义' },
          ]}
        />
        {kind === 'weekly' && (
          <div className="wd-row" role="group" aria-label="选择星期">
            {WEEKDAY_LABELS.map((label, index) => {
              const weekday = WEEKDAY_VALUES[index]
              return (
                <button key={weekday} type="button" className={`wd-chip${weekdays.includes(weekday) ? ' on' : ''}`} onClick={() => toggleWeekday(weekday)} aria-pressed={weekdays.includes(weekday)}>
                  {label}
                </button>
              )
            })}
          </div>
        )}
        {kind === 'custom' && (
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="fs13 muted">每隔</span>
            <input
              className="input num"
              style={{ width: 88 }}
              type="number"
              min={2}
              max={365}
              step={1}
              inputMode="numeric"
              value={intervalDays}
              onChange={(event) => setIntervalDays(Number(event.target.value))}
              aria-label="自定义重复间隔天数"
            />
            <span className="fs13 muted">天执行一次</span>
          </div>
        )}
      </Field>

      <div className="form-row">
        <Field label={kind === 'once' ? '执行日期' : '开始日期'}>
          <input className="input" type="date" value={date} min={beijingTodayStr()} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="执行时间（北京时间）">
          <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </Field>
      </div>

      <Field label="提前提醒">
        <Segmented
          small
          value={remind}
          onChange={(value) => setRemind(value)}
          options={[
            { value: 0, label: '准时' },
            { value: 5, label: '提前 5 分' },
            { value: 15, label: '提前 15 分' },
            { value: 30, label: '提前 30 分' },
          ]}
        />
      </Field>

      {kind !== 'once' && (
        <Field label="结束日期" error={errs.endDate}>
          <Segmented
            small
            value={hasEnd ? 'yes' : 'no'}
            onChange={(value) => setHasEnd(value === 'yes')}
            options={[
              { value: 'no', label: '一直重复' },
              { value: 'yes', label: '设结束日期' },
            ]}
          />
          {hasEnd && (
            <input className="input" type="date" value={endDate} min={date} onChange={(event) => setEndDate(event.target.value)} aria-label="结束日期" />
          )}
        </Field>
      )}

      <div className="field">
        <span className="field-l">语音播报</span>
        <div className="setting-row" style={{ paddingTop: 0 }}>
          <div className="info grow">
            <b>{voiceEnabled ? (globalSpeechEnabled ? '已开启' : '已开启（全局语音已关闭）') : '已关闭'}</b>
            <span>{globalSpeechEnabled ? '到点时使用设备原生语音播报任务名称和内容，可随时关闭。' : '此任务的开关会保留；需要在“设置”重新开启全局语音功能后才会播报。'}</span>
          </div>
          <button
            type="button"
            className={`switch${voiceEnabled ? ' on' : ''}`}
            aria-label="语音播报"
            aria-pressed={voiceEnabled}
            onClick={() => setVoiceEnabled((enabled) => !enabled)}
          />
        </div>
      </div>

      <Field label="辅助提示音" hint="可与语音播报同时开启；选择静音不会影响通知和应用内弹窗。">
        <Segmented
          small
          value={reminderSound}
          onChange={(value) => setReminderSound(value)}
          options={[
            { value: 'silent', label: '静音' },
            { value: 'chime', label: '短提示音' },
          ]}
        />
      </Field>

      <div className="field">
        <span className="field-l">系统通知</span>
        <div className="setting-row" style={{ paddingTop: 0 }}>
          <div className="info grow">
            <b>{notificationEnabled ? '允许任务发送通知' : '仅应用内提醒'}</b>
            <span>关闭后仍会显示应用内提醒，不会请求或发送此任务的系统通知。</span>
          </div>
          <button
            type="button"
            className={`switch${notificationEnabled ? ' on' : ''}`}
            aria-label="系统通知"
            aria-pressed={notificationEnabled}
            onClick={() => setNotificationEnabled((enabled) => !enabled)}
          />
        </div>
      </div>

      <Field label="提醒后标记完成" hint="每次点“标记完成”之后，这条安排接下来怎么办">
        <Segmented
          small
          value={afterDone}
          onChange={(value) => setAfterDone(value)}
          options={[
            { value: 'continue', label: '继续下一次' },
            { value: 'pause', label: '暂停任务' },
          ]}
        />
      </Field>
    </Modal>
  )
}

// ---------- 执行历史 ----------
function HistoryModal({ task, onClose }: { task: ScheduleTask; onClose: () => void }) {
  const STATUS_TEXT: Record<ScheduleRun['status'], string> = { notified: '已提醒', done: '已完成' }
  return (
    <Modal open title={`执行历史 · ${scheduleTitle(task)}`} onClose={onClose} width={480}>
      {task.history.length === 0 ? (
        <EmptyState mood="idle" title="还没有执行记录" desc="到点提醒之后，每一次的提醒和完成都会记录在这里。" />
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {task.history.map((history) => {
            const [date, time] = history.at.split('T')
            return (
              <div key={history.at} className="sched-hist">
                <span className="num">{fmtDate(date)} {weekdayCn(date)} {time}</span>
                <Chip tone={history.status === 'done' ? 'green' : 'blue'}>{STATUS_TEXT[history.status]}</Chip>
                <span className="fs12 muted">{history.handledAt ? `处理于 ${fmtDateTime(history.handledAt).slice(-5)}` : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// ---------- 任务详情 ----------
function DetailModal({
  taskId,
  onClose,
  onEdit,
}: {
  taskId: string
  onClose: () => void
  onEdit: (task: ScheduleTask) => void
}) {
  const { state, dispatch, undo } = useStore()
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const task = (state.schedules ?? []).find((item) => item.id === taskId)
  if (!task) return null

  const status = statusOf(task)
  const removed = scheduleRepeat(task).kind === 'once' && task.firedKeys.length > 0 && !task.nextRunAt
  const advance = scheduleAdvanceMinutes(task)

  const toggle = () => {
    dispatch({ type: 'SCHEDULE_TOGGLE', id: task.id })
    toast(task.enabled ? '已暂停，恢复后会重新计算下次时间' : '已恢复启用', { kind: 'success' })
  }

  const remove = async () => {
    const ok = await confirm({
      title: '删除这条安排？',
      desc: `“${scheduleTitle(task)}”会被删除，它的执行历史也会一并清除，删除后可以在提示条里撤销。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    dispatch({ type: 'SCHEDULE_DELETE', id: task.id })
    toast('已删除安排任务', { kind: 'success', action: { label: '撤销', onClick: undo } })
    onClose()
  }

  const STATUS_TEXT = { on: '启用中', off: '已暂停', ended: '已结束' } as const

  return (
    <Modal
      open
      title="任务详情"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={() => requestScheduleTest(task.id)}>
            <Icon name="zap" size={14} /> 测试提醒
          </button>
          <div className="spacer" />
          <button className="btn" onClick={() => onEdit(task)}>
            <Icon name="edit" size={14} /> 编辑
          </button>
          <button className="btn" onClick={toggle}>
            <Icon name={task.enabled ? 'pause' : 'play'} size={14} /> {task.enabled ? '暂停' : '恢复'}
          </button>
          <button className="btn btn-danger-solid" onClick={() => void remove()}>
            <Icon name="trash" size={14} /> 删除
          </button>
        </>
      }
    >
      {confirmNode}
      <div className="sched-detail">
        <div className="sched-detail-head">
          <b>{scheduleTitle(task)}</b>
          <Chip tone={status === 'on' ? 'green' : 'gray'}>{STATUS_TEXT[status]}</Chip>
          {task.snoozed && <Chip tone="yellow">稍后提醒中</Chip>}
        </div>
        {scheduleContent(task) ? (
          <p className="sched-detail-note">{scheduleContent(task)}</p>
        ) : (
          <p className="sched-detail-note muted">没有填写任务内容</p>
        )}
        <div className="stat-line">
          <span>执行时间</span>
          <b className="num">{task.time}{advance > 0 ? `（提前 ${advance} 分钟提醒）` : '（准时）'}</b>
        </div>
        <div className="stat-line">
          <span>重复规则</span>
          <b>{repeatText(task)}</b>
        </div>
        <div className="stat-line">
          <span>时区</span>
          <b>北京时间</b>
        </div>
        <div className="stat-line">
          <span>提醒声音</span>
          <b>{reminderSummary(task)}</b>
        </div>
        <div className="stat-line">
          <span>系统通知</span>
          <b>{scheduleNotificationEnabled(task) ? '允许发送' : '仅应用内提醒'}</b>
        </div>
        <div className="stat-line">
          <span>提醒后标记完成</span>
          <b>{task.afterDone === 'pause' ? '暂停任务' : '继续下一次'}</b>
        </div>
        <div className="stat-line">
          <span>下次执行</span>
          <b className="num">{task.nextRunAt ? fmtNext(task.nextRunAt) : removed ? '已执行完毕' : '暂无（已暂停）'}</b>
        </div>
        <div className="stat-line">
          <span>创建时间</span>
          <b className="num">{fmtDateTime(task.createdAt)}</b>
        </div>
        <div className="stat-line">
          <span>更新时间</span>
          <b className="num">{fmtDateTime(task.updatedAt)}</b>
        </div>
      </div>
    </Modal>
  )
}

// ---------- 主页面 ----------
export function ScheduledPage() {
  const { state, dispatch, undo } = useStore()
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const [filter, setFilter] = useState<FilterKind>('all')
  const [editing, setEditing] = useState<{ task: ScheduleTask | null } | null>(null)
  const [historyOf, setHistoryOf] = useState<ScheduleTask | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [noticePerm, setNoticePerm] = useState(scheduleNotificationPermission)
  const nativeSupported = supportsNativeScheduleNotifications()
  const [nativeNoticePerm, setNativeNoticePerm] = useState<'granted' | 'denied' | 'default' | 'unsupported'>(nativeSupported ? 'default' : 'unsupported')
  const [exactAlarmPerm, setExactAlarmPerm] = useState<'granted' | 'denied' | 'unsupported'>(nativeSupported ? 'denied' : 'unsupported')
  const globalSpeechEnabled = state.settings.speech?.enabled !== false

  useEffect(() => {
    const refresh = () => setNoticePerm(scheduleNotificationPermission())
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useEffect(() => {
    if (!nativeSupported) return
    let cancelled = false
    const refreshNativePermissions = async () => {
      const [notification, exact] = await Promise.all([
        nativeScheduleNotificationPermission(),
        nativeExactAlarmPermission(),
      ])
      if (cancelled) return
      setNativeNoticePerm(notification)
      setExactAlarmPerm(exact)
    }
    void refreshNativePermissions()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNativePermissions()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [nativeSupported])

  const tasks = state.schedules ?? []
  const onCount = tasks.filter((task) => task.enabled).length

  const shown = useMemo(() => {
    const list = tasks.filter((task) => (filter === 'all' ? true : filter === 'on' ? task.enabled : !task.enabled))
    return [...list].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      if (a.enabled) {
        if (a.nextRunAt && b.nextRunAt) return a.nextRunAt.localeCompare(b.nextRunAt)
        if (a.nextRunAt) return -1
        if (b.nextRunAt) return 1
      }
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [tasks, filter])

  const requestPermission = async () => {
    if (nativeSupported) {
      const result = await requestNativeScheduleNotificationPermission()
      setNativeNoticePerm(result)
      if (result === 'granted') {
        toast('Android 系统通知已开启', { kind: 'success' })
        // 授权前调度器会主动跳过本地排程；授权后立即用当前快照补排任务。
        void syncNativeScheduleNotifications(tasks, globalSpeechEnabled)
      }
      else if (result === 'denied') toast('通知权限仍未开启，请到 Android 系统设置中允许本应用通知', { kind: 'error' })
      return
    }
    if (typeof Notification === 'undefined') {
      setNoticePerm('unsupported')
      toast('当前环境不支持系统通知，仍会使用应用内提醒', { kind: 'error' })
      return
    }
    try {
      const result = await Notification.requestPermission()
      setNoticePerm(result)
      if (result === 'granted') toast('系统通知已开启', { kind: 'success' })
      else if (result === 'denied') toast('通知权限仍未开启，请按页面提示到系统或浏览器设置中授权', { kind: 'error' })
    } catch {
      toast('无法请求通知权限，请检查浏览器或系统设置', { kind: 'error' })
    }
  }

  const requestExactAlarm = async () => {
    const result = await requestNativeExactAlarmPermission()
    setExactAlarmPerm(result)
    if (result === 'granted') {
      toast('精确提醒已开启', { kind: 'success' })
      // 已存在的通知需要重排后才会带上精确闹钟标记。
      void syncNativeScheduleNotifications(tasks, globalSpeechEnabled)
    }
    else if (result === 'denied') toast('精确提醒未开启，系统仍会尝试使用普通闹钟提醒', { kind: 'error' })
  }

  const testReminder = async (task: ScheduleTask) => {
    if (nativeSupported) {
      const scheduled = await showNativeScheduleTestNotification(task, state.settings.speech?.enabled !== false)
      toast(scheduled ? '已排入 Android 测试通知，约 1 秒后显示' : 'Android 测试通知未排入，请先开启系统通知权限', {
        kind: scheduled ? 'success' : 'error',
      })
    }
    requestScheduleTest(task.id)
  }

  const toggleTaskVoice = (task: ScheduleTask) => {
    const enabled = !scheduleVoiceEnabled(task)
    dispatch({ type: 'SCHEDULE_UPDATE', id: task.id, patch: { voiceEnabled: enabled } })
    toast(enabled ? '已开启该任务语音播报' : '已关闭该任务语音播报', { kind: 'success' })
  }

  const remove = async (task: ScheduleTask) => {
    const ok = await confirm({
      title: '删除这条安排？',
      desc: `“${scheduleTitle(task)}”会被删除，它的执行历史也会一并清除，删除后可以在提示条里撤销。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    dispatch({ type: 'SCHEDULE_DELETE', id: task.id })
    toast('已删除安排任务', { kind: 'success', action: { label: '撤销', onClick: undo } })
  }

  return (
    <div>
      {confirmNode}
      <div className="page-h">
        <h2>已安排任务</h2>
        <span className="chip chip-blue">北京时间</span>
        <span className="chip chip-green num">启用 {onCount}</span>
        {tasks.length - onCount > 0 && <span className="chip num">暂停 {tasks.length - onCount}</span>}
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setEditing({ task: null })}>
          <Icon name="plus" size={14} /> 新建任务
        </button>
      </div>

      {nativeSupported && nativeNoticePerm === 'default' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>Android 系统通知还没有开启。授权后，即使应用退到后台也可以显示任务提醒。</span>
          <button className="btn btn-sm" onClick={() => void requestPermission()}>
            开启系统通知
          </button>
        </div>
      )}
      {nativeSupported && nativeNoticePerm === 'denied' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>Android 通知权限已被关闭，到点仍会显示应用内提醒。请到系统设置允许本应用通知后重新检查。</span>
          <button className="btn btn-sm" onClick={() => void requestPermission()}>
            重新授权
          </button>
        </div>
      )}
      {nativeSupported && nativeNoticePerm === 'granted' && exactAlarmPerm !== 'granted' && (
        <div className="card sched-notice">
          <Icon name="timer" size={16} />
          <span>精确闹钟权限未开启，Android 可能把提醒延后几分钟；需要准点提醒时可在系统设置中开启。</span>
          <button className="btn btn-sm" onClick={() => void requestExactAlarm()}>
            开启精确提醒
          </button>
        </div>
      )}
      {!nativeSupported && noticePerm === 'default' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>系统通知还没有开启。授权后，到点提醒会像普通消息一样弹出。</span>
          <button className="btn btn-sm" onClick={() => void requestPermission()}>
            开启系统通知
          </button>
        </div>
      )}
      {!nativeSupported && noticePerm === 'denied' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>通知权限已被关闭，到点仍会显示应用内提醒。请在浏览器的网站设置或系统通知设置中允许本应用，然后返回此页重新检查。</span>
          <button className="btn btn-sm" onClick={() => setNoticePerm(scheduleNotificationPermission())}>
            重新检查授权
          </button>
        </div>
      )}
      {!nativeSupported && noticePerm === 'unsupported' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>当前环境不支持系统通知，到点将使用应用内提醒。</span>
        </div>
      )}
      <div className="card sched-notice">
        <Icon name="timer" size={16} />
        <span>受环境限制：网页、桌面或手机应用完全关闭时，不能可靠播放声音；浏览器后台冻结、省电策略、系统休眠和 Android Doze 也可能导致提醒延迟。请保持应用运行，并用“测试提醒”确认当前设备可用。</span>
      </div>

      <div className="page-h" style={{ margin: '10px 0' }}>
        <Segmented
          small
          value={filter}
          onChange={(value) => setFilter(value)}
          options={[
            { value: 'all', label: `全部 ${tasks.length}` },
            { value: 'on', label: '启用中' },
            { value: 'off', label: '已暂停' },
          ]}
        />
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            mood="idle"
            title="还没有安排任务"
            desc="把每天要做的学习安排进来，到点会按北京时间提醒你，例如每天晚上八点背单词。"
            action={
              <button className="btn btn-primary" onClick={() => setEditing({ task: null })}>
                <Icon name="plus" size={14} /> 新建任务
              </button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState mood="think" title="这个筛选下没有任务" desc="切换到“全部”看看其他安排。" />
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {shown.map((task) => {
            const status = statusOf(task)
            const advance = scheduleAdvanceMinutes(task)
            return (
              <div key={task.id} className={`sched-row${task.enabled ? '' : ' paused'}`}>
                <div className="sched-when">
                  <b className="sched-time num">{task.time}</b>
                  <span className="fs12 muted">{repeatText(task)}</span>
                </div>
                <div
                  className="sched-main"
                  role="button"
                  tabIndex={0}
                  aria-label={`打开任务详情：${scheduleTitle(task)}`}
                  onClick={() => setDetailId(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setDetailId(task.id)
                    }
                  }}
                >
                  <b>{scheduleTitle(task)}</b>
                  {scheduleContent(task) && <span className="fs13 muted sched-note">{scheduleContent(task)}</span>}
                  <div className="sched-chips">
                    {status === 'on' && <Chip tone="green">启用中</Chip>}
                    {status === 'off' && <Chip tone="gray">已暂停</Chip>}
                    {status === 'ended' && <Chip tone="gray">已结束</Chip>}
                    {task.enabled && task.nextRunAt && <span className="chip chip-blue num">下次 {fmtNext(task.nextRunAt)}</span>}
                    {task.snoozed && <Chip tone="yellow">稍后提醒中</Chip>}
                    {advance > 0 && <span className="chip num">提前 {advance} 分</span>}
                    {scheduleVoiceEnabled(task) && <span className="chip chip-yellow">语音</span>}
                    {scheduleReminderSound(task) === 'chime' && <span className="chip">提示音</span>}
                  </div>
                </div>
                <div className="sched-acts">
                  <button
                    className="btn btn-icon btn-ghost"
                    title="测试提醒"
                    aria-label={`测试提醒：${scheduleTitle(task)}`}
                    onClick={() => void testReminder(task)}
                  >
                    <Icon name="zap" size={15} />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title="查看执行历史"
                    aria-label={`查看历史：${scheduleTitle(task)}`}
                    onClick={() => setHistoryOf(task)}
                  >
                    <Icon name="clock" size={15} />
                  </button>
                  <button
                    className={`btn btn-icon btn-ghost${scheduleVoiceEnabled(task) ? ' is-active' : ''}`}
                    title={scheduleVoiceEnabled(task) ? '关闭语音播报' : '开启语音播报'}
                    aria-label={`${scheduleVoiceEnabled(task) ? '关闭' : '开启'}语音播报：${scheduleTitle(task)}`}
                    aria-pressed={scheduleVoiceEnabled(task)}
                    onClick={() => toggleTaskVoice(task)}
                  >
                    <Icon name={scheduleVoiceEnabled(task) ? 'volume' : 'volumeOff'} size={15} />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title="编辑"
                    aria-label={`编辑：${scheduleTitle(task)}`}
                    onClick={() => setEditing({ task })}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title={task.enabled ? '暂停' : '恢复'}
                    aria-label={`${task.enabled ? '暂停' : '恢复'}：${scheduleTitle(task)}`}
                    onClick={() => {
                      dispatch({ type: 'SCHEDULE_TOGGLE', id: task.id })
                      toast(task.enabled ? '已暂停，恢复后会重新计算下次时间' : '已恢复启用', { kind: 'success' })
                    }}
                  >
                    <Icon name={task.enabled ? 'pause' : 'play'} size={15} />
                  </button>
                  <button className="btn btn-icon btn-ghost" title="删除" aria-label={`删除：${scheduleTitle(task)}`} onClick={() => void remove(task)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <ScheduleForm initial={editing.task} onClose={() => setEditing(null)} />}
      {historyOf && <HistoryModal task={historyOf} onClose={() => setHistoryOf(null)} />}
      {detailId && (
        <DetailModal
          taskId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(task) => {
            setDetailId(null)
            setEditing({ task })
          }}
        />
      )}
    </div>
  )
}

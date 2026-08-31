// 已安排任务:定时提醒的列表 / 创建与编辑 / 暂停恢复 / 删除 / 执行历史
import React, { useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, EmptyState, Field, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { requestScheduleTest } from '../components/ScheduleAlerts'
import { makeScheduleTask, repeatText } from '../lib/schedule'
import type { ScheduleRepeat, ScheduleRun, ScheduleTask } from '../types'
import { addDays, fmtDate, todayStr, weekdayCn } from '../lib/date'
import { uid } from '../lib/misc'

type FilterKind = 'all' | 'on' | 'off'
type FormKind = 'once' | 'daily' | 'weekly'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] // 与标签一一对应(周一…周日)

/** 下次执行时间的中文展示 */
function fmtNext(stamp: string): string {
  const today = todayStr()
  if (stamp.startsWith(today)) return `今天 ${stamp.slice(11)}`
  if (stamp.startsWith(addDays(today, 1))) return `明天 ${stamp.slice(11)}`
  const [d, t] = stamp.split('T')
  return `${fmtDate(d)} ${t}`
}

function statusOf(t: ScheduleTask): 'on' | 'off' | 'ended' {
  if (!t.enabled) return 'off'
  return t.nextRunAt ? 'on' : 'ended'
}

// ---------- 创建 / 编辑表单 ----------
function ScheduleForm({
  initial,
  onClose,
}: {
  initial: ScheduleTask | null
  onClose: () => void
}) {
  const { dispatch } = useStore()
  const toast = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [kind, setKind] = useState<FormKind>(initial?.repeat.kind ?? 'daily')
  const [date, setDate] = useState(initial?.date ?? todayStr())
  const [weekdays, setWeekdays] = useState<number[]>(
    initial?.repeat.kind === 'weekly' ? initial.repeat.weekdays : [1]
  )
  const [time, setTime] = useState(initial?.time ?? '08:00')
  const [hasEnd, setHasEnd] = useState(initial?.endDate != null)
  const [endDate, setEndDate] = useState(initial?.endDate ?? addDays(todayStr(), 30))
  const [remind, setRemind] = useState(initial?.remindBefore ?? 0)
  const [afterDone, setAfterDone] = useState(initial?.afterDone ?? 'continue')
  const [errs, setErrs] = useState<{ name?: string; weekdays?: string; endDate?: string }>({})

  const toggleWeekday = (w: number) => {
    setWeekdays((list) => (list.includes(w) ? list.filter((x) => x !== w) : [...list, w]))
  }

  const save = () => {
    const next: typeof errs = {}
    if (!name.trim()) next.name = '请填写任务名称'
    if (kind === 'weekly' && weekdays.length === 0) next.weekdays = '至少选择一个星期几'
    if (kind !== 'once' && hasEnd && endDate && endDate < date) next.endDate = '结束日期不能早于开始日期'
    if (!time) next.name = next.name ?? '请选择执行时间'
    setErrs(next)
    if (Object.keys(next).length > 0) {
      toast('请先修改标红的选项再保存', { kind: 'error' })
      return
    }
    const repeat: ScheduleRepeat =
      kind === 'once' ? { kind: 'once' } : kind === 'daily' ? { kind: 'daily' } : { kind: 'weekly', weekdays: [...weekdays].sort() }
    const common = {
      name: name.trim(),
      note: note.trim(),
      time,
      date,
      repeat,
      endDate: kind !== 'once' && hasEnd ? endDate : undefined,
      remindBefore: remind,
      afterDone,
    }
    if (initial) {
      dispatch({ type: 'SCHEDULE_UPDATE', id: initial.id, patch: common })
      toast('已保存修改', { kind: 'success' })
    } else {
      dispatch({
        type: 'SCHEDULE_ADD',
        task: makeScheduleTask({ id: uid('sch'), ...common, enabled: true, nextRunAt: null }),
      })
      toast('已创建,到点会提醒你', { kind: 'success' })
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
      <Field label="任务名称" error={errs.name} hint="例如:背诵英语词汇">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:背诵英语词汇" maxLength={30} />
      </Field>
      <Field label="学习内容(可选)" hint="提醒弹窗里会显示这段内容">
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如:Unit 3 单元词汇 20 个,边读边抄写" maxLength={120} />
      </Field>

      <Field label="重复规则" error={errs.weekdays}>
        <Segmented
          value={kind}
          onChange={(v) => setKind(v)}
          options={[
            { value: 'once', label: '只执行一次' },
            { value: 'daily', label: '每天' },
            { value: 'weekly', label: '每周指定日期' },
          ]}
        />
        {kind === 'once' && (
          <input className="input" type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} aria-label="执行日期" />
        )}
        {kind === 'daily' && <span className="field-hint">从明天起,每天这个时间都会提醒</span>}
        {kind === 'weekly' && (
          <div className="wd-row" role="group" aria-label="选择星期">
            {WEEKDAY_LABELS.map((label, i) => {
              const w = WEEKDAY_VALUES[i]
              return (
                <button key={w} type="button" className={`wd-chip${weekdays.includes(w) ? ' on' : ''}`} onClick={() => toggleWeekday(w)} aria-pressed={weekdays.includes(w)}>
                  {label}
                </button>
              )
            })}
          </div>
        )}
      </Field>

      <div className="form-row">
        <Field label="执行时间">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="提前提醒">
          <Segmented
            small
            value={remind}
            onChange={(v) => setRemind(v)}
            options={[
              { value: 0, label: '准时' },
              { value: 5, label: '提前 5 分' },
              { value: 15, label: '提前 15 分' },
              { value: 30, label: '提前 30 分' },
            ]}
          />
        </Field>
      </div>

      {kind !== 'once' && (
        <Field label="结束日期" error={errs.endDate}>
          <Segmented
            small
            value={hasEnd ? 'yes' : 'no'}
            onChange={(v) => setHasEnd(v === 'yes')}
            options={[
              { value: 'no', label: '一直重复' },
              { value: 'yes', label: '设结束日期' },
            ]}
          />
          {hasEnd && (
            <input className="input" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} aria-label="结束日期" />
          )}
        </Field>
      )}

      <Field label="提醒后标记完成" hint="每次点「标记完成」之后,这条安排接下来怎么办">
        <Segmented
          small
          value={afterDone}
          onChange={(v) => setAfterDone(v)}
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
    <Modal open title={`执行历史 · ${task.name}`} onClose={onClose} width={480}>
      {task.history.length === 0 ? (
        <EmptyState mood="idle" title="还没有执行记录" desc="到点提醒之后,每一次的提醒和完成都会记录在这里。" />
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {task.history.map((h) => {
            const [d, t] = h.at.split('T')
            return (
              <div key={h.at} className="sched-hist">
                <span className="num">{fmtDate(d)} {weekdayCn(d)} {t}</span>
                <Chip tone={h.status === 'done' ? 'green' : 'blue'}>{STATUS_TEXT[h.status]}</Chip>
                <span className="fs12 muted">{h.handledAt ? `处理于 ${h.handledAt.slice(11, 16)}` : ''}</span>
              </div>
            )
          })}
        </div>
      )}
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
  const [noticePerm, setNoticePerm] = useState<string>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )

  const tasks = state.schedules ?? []
  const onCount = tasks.filter((t) => t.enabled).length

  const shown = useMemo(() => {
    const list = tasks.filter((t) => (filter === 'all' ? true : filter === 'on' ? t.enabled : !t.enabled))
    return [...list].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      if (a.enabled) {
        if (a.nextRunAt && b.nextRunAt) return a.nextRunAt < b.nextRunAt ? -1 : 1
        if (a.nextRunAt) return -1
        if (b.nextRunAt) return 1
      }
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
  }, [tasks, filter])

  const requestPermission = () => {
    try {
      if (typeof Notification === 'undefined') return
      Notification.requestPermission().then((p) => setNoticePerm(p))
    } catch {
      // 忽略
    }
  }

  const remove = async (t: ScheduleTask) => {
    const ok = await confirm({
      title: '删除这条安排?',
      desc: `「${t.name}」会被删除,它的执行历史也会一并清除,删除后可以在提示条里撤销。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    dispatch({ type: 'SCHEDULE_DELETE', id: t.id })
    toast('已删除安排任务', { kind: 'success', action: { label: '撤销', onClick: undo } })
  }

  return (
    <div>
      {confirmNode}
      <div className="page-h">
        <h2>已安排任务</h2>
        <span className="chip chip-green num">启用 {onCount}</span>
        {tasks.length - onCount > 0 && <span className="chip num">暂停 {tasks.length - onCount}</span>}
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setEditing({ task: null })}>
          <Icon name="plus" size={14} /> 新建任务
        </button>
      </div>

      {noticePerm === 'default' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>系统通知还没有开启。开启后,到点提醒会像普通消息一样弹出,即使你正在用别的窗口。</span>
          <button className="btn btn-sm" onClick={requestPermission}>
            开启系统通知
          </button>
        </div>
      )}
      {noticePerm === 'denied' && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>通知权限已被关闭,到点只能在应用内弹窗提醒。想恢复的话,请在系统设置里允许本应用发送通知。</span>
        </div>
      )}
      {noticePerm === 'unsupported' && tasks.length > 0 && (
        <div className="card sched-notice">
          <Icon name="volume" size={16} />
          <span>当前环境不支持系统通知,到点提醒会在应用内弹出。</span>
        </div>
      )}

      <div className="page-h" style={{ margin: '10px 0' }}>
        <Segmented
          small
          value={filter}
          onChange={(v) => setFilter(v)}
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
            desc="提前把每天要做的学习安排进来,到点就会提醒你,比如每天晚上八点背单词。"
            action={
              <button className="btn btn-primary" onClick={() => setEditing({ task: null })}>
                <Icon name="plus" size={14} /> 新建任务
              </button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState mood="think" title="这个筛选下没有任务" desc="切换到「全部」看看其他安排。" />
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {shown.map((t) => {
            const st = statusOf(t)
            return (
              <div key={t.id} className={`sched-row${t.enabled ? '' : ' paused'}`}>
                <div className="sched-when">
                  <b className="sched-time num">{t.time}</b>
                  <span className="fs12 muted">{repeatText(t)}</span>
                </div>
                <div className="sched-main">
                  <b>{t.name}</b>
                  {t.note && <span className="fs13 muted sched-note">{t.note}</span>}
                  <div className="sched-chips">
                    {st === 'on' && <Chip tone="green">启用中</Chip>}
                    {st === 'off' && <Chip tone="gray">已暂停</Chip>}
                    {st === 'ended' && <Chip tone="gray">已结束</Chip>}
                    {t.enabled && t.nextRunAt && (
                      <span className="chip chip-blue num">下次 {fmtNext(t.nextRunAt)}</span>
                    )}
                    {t.snoozed && <Chip tone="yellow">稍后提醒中</Chip>}
                    {t.remindBefore > 0 && <span className="chip num">提前 {t.remindBefore} 分</span>}
                    {t.repeat.kind !== 'once' && !t.enabled && t.nextRunAt == null && t.endDate && (
                      <span className="chip">结束于 {fmtDate(t.endDate)}</span>
                    )}
                  </div>
                </div>
                <div className="sched-acts">
                  <button className="btn btn-icon btn-ghost" title="测试提醒" aria-label={`测试提醒:${t.name}`} onClick={() => requestScheduleTest(t.id)}>
                    <Icon name="zap" size={15} />
                  </button>
                  <button className="btn btn-icon btn-ghost" title="查看执行历史" aria-label={`查看历史:${t.name}`} onClick={() => setHistoryOf(t)}>
                    <Icon name="clock" size={15} />
                  </button>
                  <button className="btn btn-icon btn-ghost" title="编辑" aria-label={`编辑:${t.name}`} onClick={() => setEditing({ task: t })}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title={t.enabled ? '暂停' : '恢复'}
                    aria-label={`${t.enabled ? '暂停' : '恢复'}:${t.name}`}
                    onClick={() => {
                      dispatch({ type: 'SCHEDULE_TOGGLE', id: t.id })
                      toast(t.enabled ? '已暂停,恢复后会重新计算下次时间' : '已恢复启用', { kind: 'success' })
                    }}
                  >
                    <Icon name={t.enabled ? 'pause' : 'play'} size={15} />
                  </button>
                  <button className="btn btn-icon btn-ghost" title="删除" aria-label={`删除:${t.name}`} onClick={() => void remove(t)}>
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
    </div>
  )
}

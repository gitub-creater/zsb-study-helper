// 已安排任务(定时提醒)的测试:重复规则计算、下次执行、重启恢复、防重复提醒
import { describe, expect, it } from 'vitest'
import {
  fireAt,
  isDue,
  localStamp,
  makeScheduleTask,
  minuteFloor,
  nextOccurrence,
  parseStamp,
} from '../src/lib/schedule'
import { emptyState, reducer } from '../src/store/store'
import type { ScheduleTask, State } from '../src/types'

// 2026-08-31 是周一(测试前置断言,防止日历记错)
const MON = '2026-08-31'
expect(new Date(2026, 7, 31).getDay()).toBe(1)

function makeTask(over: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 'sch_test1',
    name: '背诵英语词汇',
    note: 'Unit 3 单元词汇',
    time: '14:30',
    date: MON,
    repeat: { kind: 'daily' },
    remindBefore: 0,
    afterDone: 'continue',
    enabled: true,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    nextRunAt: `${MON}T14:30`,
    firedKeys: [],
    history: [],
    ...over,
  }
}

function apply(state: State, ...actions: Parameters<typeof reducer>[1][]): State {
  return actions.reduce(reducer, state)
}

describe('时刻串与提前量', () => {
  it('本地时刻串与解析互逆(分钟精度)', () => {
    const d = new Date(2026, 7, 31, 14, 30)
    expect(localStamp(d)).toBe('2026-08-31T14:30')
    const back = parseStamp('2026-08-31T14:30')
    expect(back.getHours()).toBe(14)
    expect(back.getMinutes()).toBe(30)
  })

  it('提前提醒量换算弹提醒时间', () => {
    const fire = fireAt('2026-08-31T14:30', 15)
    expect(fire.getHours()).toBe(14)
    expect(fire.getMinutes()).toBe(15)
    expect(fireAt('2026-08-31T14:30', 0).getMinutes()).toBe(30)
  })
})

describe('下次执行时间计算', () => {
  it('每天:当天时间未过用今天,已过用明天', () => {
    const task = makeTask()
    expect(nextOccurrence(task, parseStamp(`${MON}T10:00`))).toBe(`${MON}T14:30`)
    expect(nextOccurrence(task, parseStamp(`${MON}T15:00`))).toBe('2026-09-01T14:30')
  })

  it('每天:触发后推进到下一天(不回到当天)', () => {
    const task = makeTask()
    expect(nextOccurrence(task, parseStamp(`${MON}T14:30`), true)).toBe('2026-09-01T14:30')
  })

  it('每周指定日期:跳过不匹配的日子,跨周正确', () => {
    const task = makeTask({ repeat: { kind: 'weekly', weekdays: [1, 3] } }) // 周一、周三
    // 周一 15:00(当天 14:30 已过)→ 周三
    expect(nextOccurrence(task, parseStamp(`${MON}T15:00`))).toBe('2026-09-02T14:30')
    // 周三触发后 → 下周一
    expect(nextOccurrence(task, parseStamp('2026-09-02T14:30'), true)).toBe('2026-09-07T14:30')
  })

  it('只执行一次:未来日期生效,过期返回空', () => {
    const future = makeTask({ repeat: { kind: 'once' }, date: '2026-09-05', nextRunAt: '2026-09-05T14:30' })
    expect(nextOccurrence(future, parseStamp(`${MON}T10:00`))).toBe('2026-09-05T14:30')
    const past = makeTask({ repeat: { kind: 'once' }, date: '2026-08-30', nextRunAt: '2026-08-30T14:30' })
    expect(nextOccurrence(past, parseStamp(`${MON}T10:00`))).toBeNull()
  })

  it('结束日期:超过后不再安排', () => {
    const task = makeTask({ endDate: '2026-09-01' })
    expect(nextOccurrence(task, parseStamp(`${MON}T15:00`))).toBe('2026-09-01T14:30')
    expect(nextOccurrence(task, parseStamp('2026-09-01T14:30'), true)).toBeNull()
  })

  it('每周一个日期都没选:返回空', () => {
    const task = makeTask({ repeat: { kind: 'weekly', weekdays: [] } })
    expect(nextOccurrence(task, parseStamp(`${MON}T10:00`))).toBeNull()
  })
})

describe('到点判定', () => {
  it('考虑提前量与防重复 key', () => {
    const task = makeTask({ remindBefore: 15 })
    expect(isDue(task, parseStamp(`${MON}T14:10`))).toBe(false)
    expect(isDue(task, parseStamp(`${MON}T14:20`))).toBe(true)
    expect(isDue({ ...task, firedKeys: [task.nextRunAt!] }, parseStamp(`${MON}T14:20`))).toBe(false)
    expect(isDue({ ...task, enabled: false }, parseStamp(`${MON}T14:20`))).toBe(false)
  })
})

describe('重启恢复与防重复提醒', () => {
  it('同一次发生重启后不会重复登记(幂等)', () => {
    const s0 = emptyState()
    const s1 = apply(s0, { type: 'SCHEDULE_ADD', task: makeTask() })
    const key = `${MON}T14:30`
    const s2 = apply(s1, { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key })
    expect(s2.schedules![0].firedKeys).toContain(key)
    expect(s2.schedules![0].history).toHaveLength(1)
    expect(s2.schedules![0].nextRunAt).toBe('2026-09-01T14:30')

    // 模拟重启:状态从存储里重新加载
    const revived = JSON.parse(JSON.stringify(s2)) as State
    const s3 = apply(revived, { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key })
    expect(s3.schedules![0].history).toHaveLength(1)
    expect(s3.schedules![0].nextRunAt).toBe('2026-09-01T14:30')
  })

  it('只执行一次的任务提醒后不再安排,重启也不会重复提醒', () => {
    const key = `${MON}T14:30`
    const s0 = emptyState()
    const s1 = apply(s0, { type: 'SCHEDULE_ADD', task: makeTask({ repeat: { kind: 'once' } }) })
    const s2 = apply(s1, { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key })
    expect(s2.schedules![0].nextRunAt).toBeNull()
    const revived = JSON.parse(JSON.stringify(s2)) as State
    expect(isDue(revived.schedules![0], parseStamp(`${MON}T15:00`))).toBe(false)
  })

  it('历史记录推进:多次发生各记一条', () => {
    const s0 = emptyState()
    const s1 = apply(
      s0,
      { type: 'SCHEDULE_ADD', task: makeTask() },
      { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key: `${MON}T14:30` },
      { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key: '2026-09-01T14:30' },
      { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key: '2026-09-02T14:30' }
    )
    expect(s1.schedules![0].history).toHaveLength(3)
    expect(s1.schedules![0].history[0].at).toBe('2026-09-02T14:30')
    expect(s1.schedules![0].nextRunAt).toBe('2026-09-03T14:30')
  })
})

describe('标记完成与暂停', () => {
  it('标记完成:历史记为已完成并推进下一次', () => {
    const key = `${MON}T14:30`
    const s0 = emptyState()
    const s1 = apply(
      s0,
      { type: 'SCHEDULE_ADD', task: makeTask() },
      { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key },
      { type: 'SCHEDULE_DONE', id: 'sch_test1', key }
    )
    const t = s1.schedules![0]
    expect(t.history[0].status).toBe('done')
    expect(t.nextRunAt).toBe('2026-09-01T14:30')
    expect(t.enabled).toBe(true)
  })

  it('完成后设为暂停:标记完成后任务自动停用', () => {
    const key = `${MON}T14:30`
    const s0 = emptyState()
    const s1 = apply(
      s0,
      { type: 'SCHEDULE_ADD', task: makeTask({ afterDone: 'pause' }) },
      { type: 'SCHEDULE_DONE', id: 'sch_test1', key }
    )
    const t = s1.schedules![0]
    expect(t.enabled).toBe(false)
    expect(t.nextRunAt).toBeNull()
    expect(t.history[0].status).toBe('done')
  })

  it('暂停清空下次时间,恢复后按当前时间重算', () => {
    const s0 = emptyState()
    const s1 = apply(s0, { type: 'SCHEDULE_ADD', task: makeTask() })
    const s2 = apply(s1, { type: 'SCHEDULE_TOGGLE', id: 'sch_test1' })
    expect(s2.schedules![0].enabled).toBe(false)
    expect(s2.schedules![0].nextRunAt).toBeNull()
    const s3 = apply(s2, { type: 'SCHEDULE_TOGGLE', id: 'sch_test1' })
    const t = s3.schedules![0]
    expect(t.enabled).toBe(true)
    expect(t.nextRunAt).not.toBeNull()
    expect(t.nextRunAt!.endsWith('T14:30')).toBe(true)
    // 重算出的时间不会落在过去
    expect(parseStamp(t.nextRunAt!).getTime()).toBeGreaterThanOrEqual(minuteFloor(new Date()).getTime())
  })
})

describe('编辑与稍后提醒', () => {
  it('修改执行时间后重算下次执行', () => {
    const s0 = emptyState()
    const s1 = apply(
      s0,
      { type: 'SCHEDULE_ADD', task: makeTask() },
      { type: 'SCHEDULE_UPDATE', id: 'sch_test1', patch: { time: '08:00' } }
    )
    const t = s1.schedules![0]
    expect(t.time).toBe('08:00')
    expect(t.nextRunAt!.endsWith('T08:00')).toBe(true)
    expect(parseStamp(t.nextRunAt!).getTime()).toBeGreaterThanOrEqual(minuteFloor(new Date()).getTime())
  })

  it('稍后提醒记录待弹时间,再次提醒处理后清除', () => {
    const key = `${MON}T14:30`
    const until = new Date(Date.now() + 5 * 60000).toISOString()
    const s0 = emptyState()
    const s1 = apply(s0, { type: 'SCHEDULE_ADD', task: makeTask() })
    const s2 = apply(s1, { type: 'SCHEDULE_SNOOZE', id: 'sch_test1', key, until })
    expect(s2.schedules![0].snoozed?.key).toBe(key)
    const s3 = apply(s2, { type: 'SCHEDULE_NOTIFIED', id: 'sch_test1', key })
    expect(s3.schedules![0].snoozed).toBeUndefined()
    expect(s3.schedules![0].history).toHaveLength(1)
  })
})

describe('新建任务', () => {
  it('创建启用任务时自动计算下次执行;停用则为空', () => {
    const on = makeScheduleTask({
      id: 'sch_a', name: '早读', note: '', time: '07:30', date: MON,
      repeat: { kind: 'daily' }, remindBefore: 0, afterDone: 'continue', enabled: true, nextRunAt: null,
    })
    expect(on.nextRunAt).not.toBeNull()
    expect(on.nextRunAt!.endsWith('T07:30')).toBe(true)
    expect(on.firedKeys).toHaveLength(0)
    expect(on.createdAt).toBeTruthy()

    const off = makeScheduleTask({
      id: 'sch_b', name: '晚自习', note: '', time: '20:00', date: MON,
      repeat: { kind: 'daily' }, remindBefore: 0, afterDone: 'continue', enabled: false, nextRunAt: null,
    })
    expect(off.nextRunAt).toBeNull()
  })
})

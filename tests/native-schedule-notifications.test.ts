import { describe, expect, it } from 'vitest'
import {
  buildNativeScheduleNotifications,
  nativeNotificationWillSound,
  nativeScheduleNotificationId,
} from '../src/services/nativeScheduleNotifications'
import type { ScheduleTask } from '../src/types'

function task(over: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 'native-test',
    name: '测试任务',
    note: '测试内容',
    title: '测试任务',
    content: '测试内容',
    time: '14:30',
    date: '2026-08-31',
    remindAt: '2026-08-31T14:30',
    repeat: { kind: 'daily' },
    repeatRule: { kind: 'daily' },
    timezone: 'Asia/Shanghai',
    remindBefore: 0,
    advanceMinutes: 0,
    voiceEnabled: true,
    notificationEnabled: true,
    reminderSound: 'silent',
    status: 'active',
    afterDone: 'continue',
    enabled: true,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    nextRunAt: '2026-08-31T14:30',
    firedKeys: [],
    history: [],
    ...over,
  }
}

describe('Android 本地提醒排程纯逻辑', () => {
  const now = new Date('2026-08-31T06:00:00.000Z') // 北京时间 14:00

  it('用确定性 ID 区分任务和发生时刻', () => {
    expect(nativeScheduleNotificationId('a', '2026-08-31T14:30')).toBe(
      nativeScheduleNotificationId('a', '2026-08-31T14:30'),
    )
    expect(nativeScheduleNotificationId('a', '2026-08-31T14:30')).not.toBe(
      nativeScheduleNotificationId('a', '2026-09-01T14:30'),
    )
    expect(nativeScheduleNotificationId('a', 'x')).toBeGreaterThan(0)
  })

  it('全局关闭语音时静音语音任务，但保留独立短提示音', () => {
    expect(nativeNotificationWillSound(task(), true)).toBe(true)
    expect(nativeNotificationWillSound(task(), false)).toBe(false)
    expect(nativeNotificationWillSound(task({ voiceEnabled: false, reminderSound: 'chime' }), false)).toBe(true)
    expect(nativeNotificationWillSound(task({ voiceEnabled: false, reminderSound: 'silent' }), true)).toBe(false)
  })

  it('只排入未来窗口内的通知，并使用静音 channel 标记无声任务', () => {
    const notifications = buildNativeScheduleNotifications(
      [task(), task({ id: 'silent', voiceEnabled: false, reminderSound: 'silent' })],
      now,
      false,
      120,
      true,
    )
    expect(notifications.length).toBeGreaterThan(0)
    expect(notifications.every((notification) => notification.schedule?.at instanceof Date)).toBe(true)
    expect(notifications.every((notification) => (notification.schedule?.at as Date).getTime() > now.getTime())).toBe(true)
    const voiceNotification = notifications.find((notification) => notification.extra?.taskId === 'native-test')
    const silentNotification = notifications.find((notification) => notification.extra?.taskId === 'silent')
    expect(voiceNotification?.channelId).toBeUndefined()
    expect(silentNotification?.channelId).toBe('zsb-schedule-silent')

    const globallyMuted = buildNativeScheduleNotifications([task()], now, false, 120, false)
    expect(globallyMuted[0]?.channelId).toBe('zsb-schedule-silent')
  })

  it('跳过已提醒发生时刻，不重复排程', () => {
    const notifications = buildNativeScheduleNotifications(
      [task({ firedKeys: ['2026-08-31T14:30'] })],
      now,
      false,
      120,
      true,
    )
    expect(notifications[0]?.extra?.key).toBe('2026-09-01T14:30')
  })
})

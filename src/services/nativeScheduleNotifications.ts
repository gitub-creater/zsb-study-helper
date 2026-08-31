// Android 原生本地通知适配层。
// 仅使用 Capacitor 官方 @capacitor/local-notifications（MIT）与系统默认通知能力；
// 应用关闭后系统可以显示通知，但不能承诺 Web Speech 的中文朗读继续运行。
import { Capacitor } from '@capacitor/core'
import type { PermissionState } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import {
  fireAt,
  nextOccurrence,
  parseStamp,
  scheduleAdvanceMinutes,
  scheduleContent,
  scheduleNotificationEnabled,
  scheduleReminderSound,
  scheduleTitle,
  scheduleVoiceEnabled,
} from '../lib/schedule'
import type { ScheduleTask } from '../types'

export const NATIVE_SCHEDULE_WINDOW_DAYS = 31
export const MAX_NATIVE_SCHEDULE_NOTIFICATIONS = 120
const NATIVE_SOURCE = 'zsb-schedule-v1'
const NATIVE_SILENT_CHANNEL = 'zsb-schedule-silent'

export type NativeSchedulePermission = 'granted' | 'denied' | 'default' | 'unsupported'
export type NativeExactAlarmPermission = 'granted' | 'denied' | 'unsupported'

/** 目前项目只生成 Android 包；网页与 Electron 继续使用 Notification API/应用内提醒。 */
export function supportsNativeScheduleNotifications(): boolean {
  return typeof window !== 'undefined'
    && Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === 'android'
}

function permissionToUi(permission: PermissionState): NativeSchedulePermission {
  if (permission === 'granted') return 'granted'
  if (permission === 'denied') return 'denied'
  return 'default'
}

export async function nativeScheduleNotificationPermission(): Promise<NativeSchedulePermission> {
  if (!supportsNativeScheduleNotifications()) return 'unsupported'
  try {
    return permissionToUi((await LocalNotifications.checkPermissions()).display)
  } catch {
    return 'unsupported'
  }
}

export async function requestNativeScheduleNotificationPermission(): Promise<NativeSchedulePermission> {
  if (!supportsNativeScheduleNotifications()) return 'unsupported'
  try {
    return permissionToUi((await LocalNotifications.requestPermissions()).display)
  } catch {
    return 'unsupported'
  }
}

export async function nativeExactAlarmPermission(): Promise<NativeExactAlarmPermission> {
  if (!supportsNativeScheduleNotifications()) return 'unsupported'
  try {
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** 仅由用户点击触发 Android 的“闹钟和提醒”系统授权页。 */
export async function requestNativeExactAlarmPermission(): Promise<NativeExactAlarmPermission> {
  if (!supportsNativeScheduleNotifications()) return 'unsupported'
  try {
    return (await LocalNotifications.changeExactNotificationSetting()).exact_alarm === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** FNV-1a 的确定性正整数 ID，满足 Android 32 位 notification ID 限制。 */
export function nativeScheduleNotificationId(taskId: string, occurrenceKey: string): number {
  let hash = 0x811c9dc5
  for (const char of `${taskId}\u0000${occurrenceKey}`) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 2_000_000_000 + 1
}

function nativeNotificationIsAudible(task: ScheduleTask, globalSpeechEnabled: boolean): boolean {
  // 语音总开关关闭时，不为“语音播报”任务保留 Android 默认通知声；
  // 辅助短提示音是任务级独立设置，仍按用户选择保留。
  return (globalSpeechEnabled && scheduleVoiceEnabled(task)) || scheduleReminderSound(task) === 'chime'
}

function notificationFromOccurrence(
  task: ScheduleTask,
  key: string,
  at: Date,
  exact: boolean,
  snooze = false,
  globalSpeechEnabled = true,
): LocalNotificationSchema {
  const audible = nativeNotificationIsAudible(task, globalSpeechEnabled)
  return {
    id: nativeScheduleNotificationId(task.id, snooze ? `snooze:${key}` : key),
    title: `学习提醒：${scheduleTitle(task)}`,
    body: scheduleContent(task) || '到时间了，开始学习吧',
    largeBody: scheduleContent(task) || `任务：${scheduleTitle(task)}`,
    summaryText: '专升本学习助手',
    // 有声音的通知不指定 channel，交给 Android 使用用户设备的默认通知音；不下载任何音频资源。
    ...(audible ? {} : { channelId: NATIVE_SILENT_CHANNEL }),
    schedule: {
      at,
      allowWhileIdle: true,
    },
    // 未取得精确闹钟授权时明确使用不精确调度，避免后台同步时意外跳转系统设置。
    isExactNotification: exact,
    foreground: false,
    extra: { source: NATIVE_SOURCE, taskId: task.id, key, snooze },
  }
}

/**
 * 生成有限未来窗口的本地通知。该函数不访问设备 API，方便测试与复用。
 * 重复规则全部在既有的北京时间日历计算中展开，而非依赖设备时区。
 */
export function buildNativeScheduleNotifications(
  tasks: ScheduleTask[],
  now = new Date(),
  exact = false,
  max = MAX_NATIVE_SCHEDULE_NOTIFICATIONS,
  globalSpeechEnabled = true,
): LocalNotificationSchema[] {
  const deadline = new Date(now.getTime() + NATIVE_SCHEDULE_WINDOW_DAYS * 86400000)
  const notifications: LocalNotificationSchema[] = []

  for (const task of tasks) {
    if (!task.enabled || !scheduleNotificationEnabled(task)) continue

    if (task.snoozed) {
      const at = new Date(task.snoozed.until)
      if (!Number.isNaN(at.getTime()) && at.getTime() > now.getTime() && at.getTime() <= deadline.getTime()) {
        notifications.push(notificationFromOccurrence(task, task.snoozed.key, at, exact, true, globalSpeechEnabled))
      }
      continue
    }

    // occurrence 时刻必须至少为“现在 + 提前提醒量”，确保不会把已经错过的通知再次排进系统队列。
    const threshold = new Date(now.getTime() + scheduleAdvanceMinutes(task) * 60000)
    let occurrence = nextOccurrence(task, threshold)
    while (occurrence && notifications.length < max) {
      const fireTime = fireAt(occurrence, scheduleAdvanceMinutes(task))
      if (fireTime.getTime() > deadline.getTime()) break
      if (!task.firedKeys.includes(occurrence) && fireTime.getTime() > now.getTime()) {
        notifications.push(notificationFromOccurrence(task, occurrence, fireTime, exact, false, globalSpeechEnabled))
      }
      occurrence = nextOccurrence(task, parseStamp(occurrence), true)
    }
    if (notifications.length >= max) break
  }

  return notifications.slice(0, max)
}

/**
 * 让调用方在不依赖 Capacitor 运行时的情况下预览任务的 Android 通知声音状态。
 * 语音总开关关闭时，任务仍可显示通知；仅取消由语音播报带来的默认提示音。
 */
export function nativeNotificationWillSound(task: ScheduleTask, globalSpeechEnabled = true): boolean {
  return nativeNotificationIsAudible(task, globalSpeechEnabled)
}

async function ensureNativeChannels(): Promise<void> {
  // Android 8+ 的 channel 不指定 sound 时为静音；有声音的任务则保留系统默认通知 channel。
  await LocalNotifications.createChannel({
    id: NATIVE_SILENT_CHANNEL,
    name: '学习提醒（静音）',
    description: '已关闭提醒声音的学习任务仍会显示系统通知',
    importance: 4,
    vibration: false,
  })
}

function isOwnedNotification(notification: { extra?: unknown }): boolean {
  const extra = notification.extra
  return typeof extra === 'object' && extra !== null && (extra as { source?: unknown }).source === NATIVE_SOURCE
}

let syncQueue: Promise<void> = Promise.resolve()

/**
 * 用当前任务快照覆盖 Android 未来 31 天的本地排程。
 * 权限未授予时不弹系统授权框，等待用户在“已安排任务”页主动授权。
 */
export function syncNativeScheduleNotifications(tasks: ScheduleTask[], globalSpeechEnabled = true): Promise<void> {
  const run = async () => {
    if (!supportsNativeScheduleNotifications()) return
    const permission = await nativeScheduleNotificationPermission()
    if (permission !== 'granted') return

    await ensureNativeChannels()
    const exact = await nativeExactAlarmPermission() === 'granted'
    const pending = await LocalNotifications.getPending()
    const previous = pending.notifications.filter(isOwnedNotification).map(({ id }) => ({ id }))
    if (previous.length > 0) await LocalNotifications.cancel({ notifications: previous })

    const notifications = buildNativeScheduleNotifications(tasks, new Date(), exact, MAX_NATIVE_SCHEDULE_NOTIFICATIONS, globalSpeechEnabled)
    if (notifications.length > 0) await LocalNotifications.schedule({ notifications })
  }

  // React 状态可能连续变更；串行化确保最后一个快照最终覆盖前一个排程。
  syncQueue = syncQueue.then(run, run)
  return syncQueue
}

/** “测试提醒”在 Android 同时排一条系统通知，验证权限与系统默认声音。 */
export async function showNativeScheduleTestNotification(task: ScheduleTask, globalSpeechEnabled = true): Promise<boolean> {
  if (!supportsNativeScheduleNotifications()) return false
  if (await nativeScheduleNotificationPermission() !== 'granted') return false
  try {
    await ensureNativeChannels()
    const exact = await nativeExactAlarmPermission() === 'granted'
    const at = new Date(Date.now() + 1200)
    const key = `test:${at.toISOString()}`
    await LocalNotifications.schedule({ notifications: [notificationFromOccurrence(task, key, at, exact, false, globalSpeechEnabled)] })
    return true
  } catch {
    return false
  }
}

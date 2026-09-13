// 云端注册补偿队列:注册请求超时/断网时,在本次会话内后台自动重试,不再等用户手动重新登录。
//
// 为什么需要:注册接口要串行完成查重、加盐哈希、写账号、建会话,实测耗时 2-4 秒以上。
// 网络稍慢就会失败,旧逻辑只留一个"待同步"标记,用户不重新登录就永远不会补注册,
// 于是账号只存在本机、好友搜不到。
//
// 密码只保留在内存里(不写 localStorage、不进云快照);页面关闭即丢弃,
// 剩下的补注册仍由登录页在用户下次输入同一密码时完成。
import { getSession, setCloudRegistrationPending, setSession } from '../lib/auth'
import { registerCloud } from './cloud'

interface PendingRegistration {
  id: string
  name: string
  password: string
  attempts: number
}

/** 退避序列:先密后疏,避免长时间无效重试拖住慢网络。 */
const RETRY_DELAYS_MS = [3000, 8000, 20000, 45000, 90000]

const queue = new Map<string, PendingRegistration>()
const listeners = new Set<(pendingCount: number) => void>()
let timer: number | null = null
let running = false

function notify(): void {
  listeners.forEach((listener) => listener(queue.size))
}

/** 供界面显示"正在后台补注册"的数量。 */
export function subscribePendingRegistrations(listener: (pendingCount: number) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function pendingRegistrationCount(): number {
  return queue.size
}

function clearTimer(): void {
  if (timer != null) {
    globalThis.clearTimeout(timer)
    timer = null
  }
}

function schedule(delayMs: number): void {
  if (timer != null || queue.size === 0) return
  timer = globalThis.setTimeout(() => {
    timer = null
    void flush()
  }, delayMs) as unknown as number
}

/**
 * 立即尝试补注册队列中的账号。
 * 重试是安全的:服务端对「同一 ID + 同一账号名 + 正确密码」的重复注册会复用账号并新建会话,
 * 所以"写库已成功但响应丢失"的情况不会产生重复账号或覆盖数据。
 */
export async function flush(): Promise<void> {
  if (running || queue.size === 0) return
  running = true
  try {
    for (const entry of [...queue.values()]) {
      const result = await registerCloud(entry.id, entry.name, entry.password)

      if (result.kind === 'ok') {
        queue.delete(entry.id)
        setCloudRegistrationPending(entry.id, false)
        // 补注册成功后立刻把云端会话写回当前登录态,学习数据随即开始同步。
        const session = getSession()
        if (session?.userId === entry.id && !session.cloudToken) {
          setSession({ ...session, cloudToken: result.session.token, cloudApiUrl: result.session.apiUrl })
        }
        notify()
        continue
      }

      // 账号被占用等确定性错误重试也不会变,留给用户处理,不再占用队列。
      if (result.kind === 'error') {
        queue.delete(entry.id)
        notify()
        continue
      }

      entry.attempts += 1
      if (entry.attempts >= RETRY_DELAYS_MS.length) {
        // 放弃自动重试,但保留"待同步"标记:用户下次用同一密码登录仍会补注册。
        queue.delete(entry.id)
        notify()
      }
    }
  } finally {
    running = false
  }

  if (queue.size > 0) {
    const nextAttempt = Math.min(...[...queue.values()].map((entry) => entry.attempts))
    schedule(RETRY_DELAYS_MS[Math.min(nextAttempt, RETRY_DELAYS_MS.length - 1)])
  } else {
    clearTimer()
  }
}

/** 注册请求因网络原因未完成时调用:标记待同步并开始后台重试。 */
export function queueCloudRegistration(account: { id: string; name: string; password: string }): void {
  setCloudRegistrationPending(account.id, true)
  queue.set(account.id, { ...account, attempts: 0 })
  notify()
  startCloudRegistrationRetries()
  schedule(RETRY_DELAYS_MS[0])
}

/** 用户主动退出或切换账号时清理内存中的密码。 */
export function clearQueuedRegistration(id: string): void {
  if (queue.delete(id)) notify()
  if (queue.size === 0) clearTimer()
}

let wired = false

/** 网络恢复或窗口重新获得焦点时立即重试,不必等退避定时器。 */
export function startCloudRegistrationRetries(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  const retry = () => { void flush() }
  window.addEventListener('online', retry)
  window.addEventListener('focus', retry)
}

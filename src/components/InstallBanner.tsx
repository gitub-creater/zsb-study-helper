import { Capacitor } from '@capacitor/core'
import React, { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Mascot } from './Mascot'

type OS = 'android' | 'ios' | 'pc'
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const RELEASE_BASE = 'https://github.com/gitub-creater/zsb-study-helper/releases/latest/download'
const ANDROID_APK_URL = `${RELEASE_BASE}/ZSB-Study-Helper.apk`
const WINDOWS_INSTALLER_URL = `${RELEASE_BASE}/ZSB-Study-Helper-Setup.exe`

let deferredPrompt: BeforeInstallPromptEvent | null = null

function detectOS(): OS {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'pc'
}

function isInstalledPwa(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function isNativeWrapper(): boolean {
  return Capacitor.isNativePlatform() || /Electron\//.test(navigator.userAgent)
}

function InstallAction({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 8,
        background: '#2465B8',
        color: '#fff',
        fontSize: 14,
        fontWeight: 700,
        textDecoration: 'none',
        touchAction: 'manipulation',
      }}
    >
      <Icon name="download" size={18} />
      {label}
    </a>
  )
}

export function InstallBanner() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [installReady, setInstallReady] = useState(Boolean(deferredPrompt))
  const [showIosSteps, setShowIosSteps] = useState(false)
  const os = detectOS()

  useEffect(() => {
    if (isNativeWrapper() || isInstalledPwa()) return
    if (sessionStorage.getItem('install_banner_dismissed') === '1') return

    const handler = (event: Event) => {
      event.preventDefault()
      deferredPrompt = event as BeforeInstallPromptEvent
      setInstallReady(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    const timer = window.setTimeout(() => setVisible(true), 1600)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  if (!visible || dismissed || isNativeWrapper()) return null

  const dismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('install_banner_dismissed', '1')
  }

  const installPwa = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice
    deferredPrompt = null
    setInstallReady(false)
    if (result.outcome === 'accepted') dismiss()
  }

  const title = os === 'pc' ? '安装 Windows 电脑端' : os === 'android' ? '安装 Android 手机端' : '添加到 iPhone 主屏幕'
  const detail = os === 'pc'
    ? '下载新版安装程序，安装时会自动替换旧版本。'
    : os === 'android'
      ? '下载 APK 后点开安装。新版会覆盖同一签名的旧版本。'
      : 'Safari 中添加到主屏幕后，可像普通 App 一样打开。'

  return (
    <aside
      aria-label={title}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 100,
        width: 'min(420px, calc(100vw - 32px))',
        padding: 14,
        background: '#fff',
        border: '1px solid #DCE7F5',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(36,101,184,.16)',
      }}
    >
      <button
        type="button"
        aria-label="关闭安装提示"
        onClick={dismiss}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 36,
          height: 36,
          display: 'grid',
          placeItems: 'center',
          border: 0,
          background: 'transparent',
          color: '#6B7A90',
          cursor: 'pointer',
        }}
      >
        <Icon name="close" size={18} />
      </button>

      <div style={{ display: 'flex', gap: 10, paddingRight: 32 }}>
        <Mascot mood="remind" size={40} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#26313E', fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ marginTop: 3, color: '#68788F', fontSize: 12, lineHeight: 1.5 }}>{detail}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {os === 'android' && <InstallAction href={ANDROID_APK_URL} label="下载 Android APK" />}
        {os === 'pc' && <InstallAction href={WINDOWS_INSTALLER_URL} label="下载 Windows 安装包" />}
        {os === 'ios' && installReady && (
          <button
            type="button"
            onClick={installPwa}
            style={{
              minHeight: 44,
              padding: '10px 14px',
              border: 0,
              borderRadius: 8,
              background: '#2465B8',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            安装到主屏幕
          </button>
        )}
        {os === 'ios' && !installReady && (
          <button
            type="button"
            onClick={() => setShowIosSteps((value) => !value)}
            style={{
              minHeight: 44,
              padding: '10px 14px',
              border: '1px solid #2465B8',
              borderRadius: 8,
              background: '#fff',
              color: '#2465B8',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            查看安装方法
          </button>
        )}
      </div>

      {os === 'ios' && showIosSteps && (
        <p style={{ margin: '10px 0 0', color: '#68788F', fontSize: 12, lineHeight: 1.55 }}>
          请在 Safari 点击分享按钮，选择“添加到主屏幕”，再点击“添加”。
        </p>
      )}
      {os === 'android' && (
        <p style={{ margin: '10px 0 0', color: '#68788F', fontSize: 11, lineHeight: 1.5 }}>
          首次安装需在系统确认安装。登录原来的云端账号后，学习记录会自动同步。
        </p>
      )}
      {os === 'pc' && (
        <p style={{ margin: '10px 0 0', color: '#68788F', fontSize: 11, lineHeight: 1.5 }}>
          安装完成后，应用会自动检查 GitHub 发布的新版本并提示更新。
        </p>
      )}
    </aside>
  )
}

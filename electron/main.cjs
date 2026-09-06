const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('node:path')

// 自动更新容错加载:依赖缺失(如手工替换 asar)时禁用更新而不是让整个应用崩溃
let autoUpdater = null
try {
  ({ autoUpdater } = require('electron-updater'))
} catch {
  console.warn('[main] electron-updater 不可用,自动更新已禁用')
}

let mainWindow

// 定时学习提醒不是点击事件触发。桌面端在应用运行时允许其播放用户已开启的声音；网页端仍受浏览器策略约束。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#F2F6FB',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function configureUpdates() {
  if (!app.isPackaged || !autoUpdater) return

  autoUpdater.autoDownload = true
  autoUpdater.on('error', () => undefined)
  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['立即安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '发现新版本',
      message: '新版本已经下载完成。',
      detail: '点击“立即安装”会关闭应用并自动覆盖当前版本。',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 5000)
}

app.whenReady().then(() => {
  createWindow()
  configureUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

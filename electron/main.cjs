const { app, BrowserWindow, dialog, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')

let mainWindow

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
  if (!app.isPackaged) return

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

const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const packaged = app.isPackaged
const children = new Set()
let backend
let mainWindow
let splashWindow
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(async () => {
    await createSplashWindow()
    try {
      await startApplication()
    } catch (error) {
      closeSplashWindow()
      await dialog.showMessageBox({
        type: 'error',
        title: 'Numora could not start',
        message: 'Numora could not start its local workspace.',
        detail: error instanceof Error ? error.message : String(error),
      })
      app.quit()
    }
  })
}

ipcMain.handle('numora:choose-workspace-directory', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const selection = await dialog.showOpenDialog(parent, {
    title: 'Choose Numora workspace folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  return selection.canceled ? '' : selection.filePaths[0]
})

async function startApplication() {
  updateSplashStage('Starting your private workspace', 'Waking up Numora’s local services.')
  const apiPort = await findAvailablePort()
  const nodeExecutable = getNodeExecutable()
  const serverPath = path.join(projectRoot, 'server.mjs')
  const serverEnvironment = {
    ...process.env,
    NUMORA_API_PORT: String(apiPort),
    NUMORA_DESKTOP: packaged ? '1' : '0',
  }

  if (!packaged) {
    // Keep development data and downloaded models beside the project, where
    // the existing Numora workspace and its ignored model cache already live.
    serverEnvironment.LOCALAPPDATA = path.dirname(projectRoot)
    serverEnvironment.APPDATA = path.join(projectRoot, '.cache', 'desktop-roaming')
  }

  backend = startChild(nodeExecutable, [serverPath], serverEnvironment, 'Numora local API')
  await waitForChildSpawn(backend)
  updateSplashStage('Preparing your local ledger', 'Your records stay on this device.')
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, backend)

  let startUrl = `http://127.0.0.1:${apiPort}`
  if (!packaged) {
    updateSplashStage('Opening the workspace', 'Bringing your desktop app into view.')
    const uiPort = await findAvailablePort()
    const vitePath = path.join(projectRoot, 'client', 'node_modules', 'vite', 'bin', 'vite.js')
    const viteEnvironment = { ...process.env, NUMORA_API_PORT: String(apiPort) }
    const vite = startChild(nodeExecutable, [vitePath, '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], viteEnvironment, 'Numora development UI')
    await waitForChildSpawn(vite)
    startUrl = `http://127.0.0.1:${uiPort}`
    await waitForHttp(`${startUrl}/`, children)
  }

  mainWindow = new BrowserWindow({
    title: 'Numora',
    width: 1440,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f8f7',
    icon: path.join(__dirname, 'numora-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (new URL(targetUrl).origin !== new URL(startUrl).origin) event.preventDefault()
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    closeSplashWindow()
  })
  await mainWindow.loadURL(startUrl)
  if (process.env.NUMORA_OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
}

async function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 620,
    height: 480,
    minWidth: 620,
    minHeight: 480,
    maxWidth: 620,
    maxHeight: 480,
    center: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'numora-icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  splashWindow.setMenu(null)
  splashWindow.once('ready-to-show', () => splashWindow?.show())
  await splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  if (splashWindow && !splashWindow.isVisible()) splashWindow.show()
  splashWindow.on('closed', () => { splashWindow = undefined })
}

function updateSplashStage(title, detail) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const safeTitle = JSON.stringify(title)
  const safeDetail = JSON.stringify(detail)
  void splashWindow.webContents.executeJavaScript(`
    document.querySelector('[data-stage]').textContent = ${safeTitle};
    document.querySelector('[data-detail]').textContent = ${safeDetail};
  `).catch(() => {})
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const windowToClose = splashWindow
  void windowToClose.webContents.executeJavaScript('document.documentElement.classList.add("is-leaving")').catch(() => {})
  setTimeout(() => {
    if (!windowToClose.isDestroyed()) windowToClose.close()
  }, 280)
}

function getNodeExecutable() {
  if (process.platform !== 'win32') return 'node'
  const executable = path.join(projectRoot, 'node_modules', 'node', 'bin', 'node.exe')
  return executable
}

function startChild(executable, args, env, label) {
  const child = spawn(executable, args, { cwd: projectRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`))
  child.once('exit', (code, signal) => {
    children.delete(child)
    if (child === backend) backend = undefined
    if (!quitting && (code !== 0 || signal)) {
      const detail = `${label} stopped${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}. Restart Numora to try again.`
      void dialog.showMessageBox({ type: 'error', title: 'Numora stopped', message: 'A local Numora service stopped unexpectedly.', detail })
    }
  })
  child.once('error', (error) => {
    children.delete(child)
    if (child === backend) backend = undefined
    if (!quitting && child.pid) void dialog.showMessageBox({ type: 'error', title: 'Numora could not start', message: `Could not start ${label}.`, detail: error.message })
  })
  return child
}

function waitForChildSpawn(child) {
  return new Promise((resolve, reject) => {
    if (child.pid) {
      resolve()
      return
    }
    child.once('spawn', resolve)
    child.once('error', reject)
  })
}

async function findAvailablePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const { port } = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForHttp(url, watchedChildren) {
  const deadline = Date.now() + 60_000
  const monitoredChildren = Array.isArray(watchedChildren) ? watchedChildren : [watchedChildren]
  let lastError
  while (Date.now() < deadline) {
    const stopped = monitoredChildren.find((child) => child.exitCode !== null || child.signalCode !== null)
    if (stopped) throw new Error(`A local Numora service exited before it was ready. Check the console output and restart Numora.`)
    try {
      await requestHttp(url)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`The local Numora service did not become ready at ${url}.${lastError ? ` ${lastError.message}` : ''}`)
}

function requestHttp(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume()
      if (response.statusCode && response.statusCode < 500) resolve()
      else reject(new Error(`Local service returned HTTP ${response.statusCode || 'unknown'}.`))
    })
    request.setTimeout(2_000, () => request.destroy(new Error('Local service request timed out.')))
    request.once('error', reject)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 8_000)),
  ])
  if (!graceful && child.exitCode === null && child.signalCode === null) child.kill()
}

app.on('before-quit', (event) => {
  if (quitting || children.size === 0) {
    quitting = true
    return
  }
  event.preventDefault()
  quitting = true
  Promise.all([...children].map(stopChild)).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

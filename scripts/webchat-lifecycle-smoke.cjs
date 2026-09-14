const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('path')

const IDLE_MS = Number(process.env.WEBCHAT_IDLE_MS || 800)

app.commandLine.appendSwitch('disable-gpu')

const done = new Promise((resolve) => {
  ipcMain.once('webchat-smoke', (_event, payload) => resolve(payload))
})

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        webviewTag: true,
        sandbox: false,
        nodeIntegration: true,
        contextIsolation: false
      }
    })
    await win.loadFile(join(__dirname, 'webchat-lifecycle-smoke.html'), {
      query: { idle: String(IDLE_MS) }
    })
    const result = await Promise.race([
      done,
      new Promise((resolve) =>
        setTimeout(() => resolve({ ok: false, reason: 'main process timed out' }), IDLE_MS + 20_000)
      )
    ])
    win.destroy()
    if (!result || !result.ok) {
      console.error('webchat lifecycle smoke failed:', result)
      app.exit(1)
      return
    }
    console.log(
      `webchat lifecycle smoke ok: parked guest ${result.idWhileParked} survived until destroy`
    )
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

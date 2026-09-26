// Run with: npx electron scripts/studio-smoke.cjs
// Real renderer components with a delayed, in-memory IPC fixture; never opens user data.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')
const output = mkdtempSync(join(tmpdir(), 'bikorch-studio-smoke-'))
console.log('Studio smoke artifacts: ' + output)
app.setPath('userData', join(output, 'electron-data'))
app.commandLine.appendSwitch('disable-gpu')
let server
let win
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const evaluate = (source) => win.webContents.executeJavaScript(source)
async function until(source, label) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await evaluate(source)) return
    await delay(80)
  }
  throw new Error('Timed out: ' + label)
}
async function screenshot(name, width, height) {
  win.setContentSize(width, height)
  await delay(180)
  const overflow = await evaluate(`(() => {
    const selectors = ['.welcome-screen', '.welcome-action-card', '.welcome-recent-row', '.studio-launcher', '.app-header', '.workspace-frame'];
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => el.getBoundingClientRect().width > 0 && (el.getBoundingClientRect().right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2)).map(() => selector));
  })()`)
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  assert.deepEqual(overflow, [], name + ' has horizontal overflow')
}

app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const tailwind = (await import('@tailwindcss/vite')).default
  server = await createServer({
    configFile: false,
    root: resolve(__dirname, '..'),
    plugins: [react(), tailwind()],
    resolve: { alias: { '@renderer': resolve(__dirname, '../src/renderer'), '@shared': resolve(__dirname, '../src/shared') } },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error'
  })
  await server.listen()
  win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message) })
  await win.loadURL(server.resolvedUrls.local[0] + 'scripts/fixtures/studio-preview.html')
  await until(`Boolean(document.querySelector('.welcome-action-card'))`, 'welcome')
  await screenshot('home-desktop', 1280, 900)
  await screenshot('home-tablet', 768, 1024)
  await screenshot('home-mobile', 390, 844)
  await screenshot('home-small', 360, 740)
  // Picker cancellation must leave the original welcome screen usable.
  await evaluate(`window.studioFixture.setFolder(null); document.querySelector('.welcome-action-card').click()`)
  await delay(180)
  assert.equal(await evaluate(`Boolean(document.querySelector('.welcome-action-card'))`), true, 'cancel picker')
  await evaluate(`window.studioFixture.setFolder('/projects/aurora-studio'); document.querySelector('.welcome-action-card').click()`)
  await until(`Boolean(document.querySelector('.studio-launcher'))`, 'open project')
  await screenshot('workspace-mobile', 390, 844)
  await screenshot('workspace-desktop', 1280, 900)
  await evaluate(`document.querySelector('[aria-label="Show files"]').click()`)
  await until(`document.querySelector('.file-tree-list')?.textContent.includes('README.md')`, 'registered project files')
  assert.deepEqual(await evaluate('window.studioFixture.errors'), [])
  await evaluate(`document.querySelector('.file-tree-row.is-folder').click()`)
  await until(`document.querySelector('.file-tree-branch')?.textContent.includes('Empty folder')`, 'empty subfolder')
  const count = await evaluate(`window.studioFixture.reads['/projects/aurora-studio/empty']`)
  await delay(450)
  assert.equal(await evaluate(`window.studioFixture.reads['/projects/aurora-studio/empty']`), count, 'empty folder must not repeatedly load')
  await evaluate(`window.studioFixture.setFailure(true); document.querySelector('.file-tree-row.is-folder').click()`)
  await until(`document.querySelector('.file-tree-row.is-folder').getAttribute('aria-expanded') === 'false'`, 'collapse folder')
  await evaluate(`document.querySelector('.file-tree-row.is-folder').click()`)
  await until(`Boolean(document.querySelector('.file-tree-inline-error'))`, 'subfolder error')
  const failedCount = await evaluate(`window.studioFixture.reads['/projects/aurora-studio/empty']`)
  await delay(450)
  assert.equal(await evaluate(`window.studioFixture.reads['/projects/aurora-studio/empty']`), failedCount, 'failed subfolder must not automatically retry')
  await evaluate(`window.studioFixture.setFailure(false); document.querySelector('.file-tree-inline-error button').click()`)
  await until(`document.querySelector('.file-tree-branch')?.textContent.includes('Empty folder')`, 'subfolder retry')
  await screenshot('files-desktop', 1280, 900)
  await evaluate(`window.studioFixture.setFailure(true); document.querySelector('[aria-label="Refresh files"]').click()`)
  await until(`Boolean(document.querySelector('.file-tree-error'))`, 'folder recovery UI')
  assert.equal(await evaluate(`document.querySelector('.file-tree-error').textContent.includes('Error invoking')`), false)
  await screenshot('files-recovery-mobile', 390, 844)
  await evaluate(`window.studioFixture.setFailure(false); document.querySelector('.file-tree-error button').click()`)
  await until(`document.querySelector('.file-tree-list')?.textContent.includes('README.md')`, 'retry recovers')
  await evaluate(`window.studioFixture.setFailure(true); document.querySelector('[aria-label="Refresh files"]').click()`)
  await until(`Boolean(document.querySelector('.file-tree-error'))`, 'reconnect error')
  await evaluate(`window.studioFixture.setFailure(false); window.studioFixture.setFolder('/projects/relocated'); document.querySelectorAll('.file-tree-error button')[1].click()`)
  await until(`document.querySelector('.file-tree-meta')?.textContent.includes('relocated') && document.querySelector('.file-tree-list')?.textContent.includes('README.md')`, 'reconnect moved root')
  assert.equal(await evaluate(`document.querySelectorAll('[role="tab"]').length`), 1, 'reconnect must update the same project, not add a duplicate')
  await evaluate(`window.studioFixture.switchProject('slow-project')`)
  await until(`Boolean(window.studioFixture.reads['/projects/slow-project'])`, 'slow request started')
  await evaluate(`window.studioFixture.switchProject('new-project')`)
  await until(`document.querySelector('.file-tree-meta')?.textContent.includes('new-project') && document.querySelector('.file-tree-list')?.textContent.includes('README.md')`, 'switch project')
  await delay(800)
  assert.equal(await evaluate(`document.querySelector('.file-tree-list').textContent.includes('old-project.txt')`), false, 'stale reads must not overwrite the active project')
  await evaluate(`document.querySelector('[aria-label="Project home"]').click()`)
  await until(`document.querySelectorAll('.welcome-recent-row').length === 3`, 'home with projects')
  await screenshot('home-projects-desktop', 1280, 900)
  await screenshot('home-projects-mobile', 390, 844)
  await evaluate(`document.querySelector('.welcome-recent-row').click()`)
  await until(`Boolean(document.querySelector('.studio-launcher'))`, 'reopen saved project')
  await win.loadURL(server.resolvedUrls.local[0] + 'scripts/fixtures/studio-preview.html?bootstrap=1')
  await until(`Boolean(document.querySelector('[data-bootstrap-ready]'))`, 'StrictMode bootstrap')
  await delay(1000)
  assert.equal(await evaluate(`document.querySelector('[data-bootstrap-ready]').dataset.bootstrapError`), '')
  assert.equal(await evaluate('window.studioFixture.emptySaves()'), 0, 'effect replay must not persist the empty pre-hydration store')
  assert.equal(await evaluate(`document.querySelector('.studio-project-tag').textContent`), 'Restored project')
  assert.deepEqual(errors, [], 'renderer console errors')
  console.log('Studio smoke passed: 4 viewport sizes, picker cancel/open, project registration, empty folders, recovery/retry, stale responses, project home and StrictMode bootstrap.')
  console.log('Screenshots: ' + output)
  win.destroy()
  await server.close()
  app.exit(0)
}).catch(async (error) => {
  console.error(error)
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await server.close()
  app.exit(1)
})

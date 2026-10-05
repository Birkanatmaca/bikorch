// Run with: npx electron scripts/manager-smoke.cjs
// Exercises the real Manager renderer using isolated, delayed IPC fixtures.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')

const output = mkdtempSync(join(tmpdir(), 'bikorch-manager-smoke-'))
console.log('Manager smoke artifacts: ' + output)
app.setPath('userData', join(output, 'electron-data'))
app.commandLine.appendSwitch('disable-gpu')
let server
let win
const errors = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const evaluate = (source) => win.webContents.executeJavaScript(source)
async function until(source, label) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try { if (await evaluate(source)) return } catch (error) { lastError = error }
    await delay(80)
  }
  throw new Error('Timed out: ' + label + (lastError ? ` (${lastError})` : ''))
}
async function click(label) {
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(label)} || item.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)}); button.click(); })()`)
}
async function send(message) {
  await evaluate(`(() => {
    const input = document.querySelector('textarea[aria-label="Message Manager"]');
    if (!input) throw new Error('Missing Manager composer');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(message)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await until(`document.querySelector('[aria-label="Send message"]')?.disabled === false`, 'composer enables send')
  await click('Send message')
}
async function screenshot(name, width, height) {
  win.setContentSize(width, height)
  await delay(180)
  const layout = await evaluate(`(() => {
    const manager = document.querySelector('.developer-secretary.is-open');
    const sidebar = document.querySelector('.secretary-sidebar');
    const log = document.querySelector('.secretary-chat-log');
    const composer = document.querySelector('.secretary-compose');
    const input = document.querySelector('textarea[aria-label="Message Manager"]');
    return { right: manager.getBoundingClientRect().right, width: manager.getBoundingClientRect().width,
      overflow: sidebar.scrollWidth - sidebar.clientWidth, logHeight: log.getBoundingClientRect().height,
      height: sidebar.getBoundingClientRect().height, composerBottom: composer.getBoundingClientRect().bottom,
      inputVisible: !!input && input.getBoundingClientRect().height > 0 };
  })()`)
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  assert.equal(layout.right <= width + 1, true, name + ': Manager stays inside viewport')
  assert.equal(layout.overflow <= 2, true, name + ': no horizontal overflow')
  assert.equal(layout.logHeight >= layout.height * 0.45, true, name + ': conversation gets most of the available height')
  assert.equal(layout.composerBottom <= height + 1, true, name + ': composer visible')
  assert.equal(layout.inputVisible, true, name + ': accessible composer visible')
}

app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const tailwind = (await import('@tailwindcss/vite')).default
  server = await createServer({ configFile: false, root: resolve(__dirname, '..'), plugins: [react(), tailwind()],
    resolve: { alias: { '@renderer': resolve(__dirname, '../src/renderer'), '@shared': resolve(__dirname, '../src/shared') } },
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message) })
  await win.loadURL(server.resolvedUrls.local[0] + 'scripts/fixtures/manager-preview.html')
  await until(`Boolean(document.querySelector('textarea[aria-label="Message Manager"]'))`, 'Manager chat')
  await until(`document.querySelector('.secretary-chat-log')?.textContent.includes('Project review:')`, 'proactive project review')
  assert.equal(await evaluate(`window.managerFixture.chatRequests.filter(request => request.purpose === 'project-review').length`), 1, 'StrictMode must not duplicate initial inspection')
  assert.equal(await evaluate(`window.managerFixture.subscriptions()`), 1, 'one Manager event subscription after effect replay')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Manager tools"]').getAttribute('aria-expanded')`), 'false', 'tools are collapsed by default')
  assert.equal(await evaluate(`Boolean(document.querySelector('.secretary-ops'))`), false, 'operations do not occupy the conversation by default')
  await screenshot('manager-desktop', 1280, 900)
  await screenshot('manager-tablet', 768, 1024)
  await screenshot('manager-mobile', 390, 844)
  await screenshot('manager-small', 360, 740)
  await click('Manager tools')
  await until(`document.querySelector('[aria-label="Manager tools"]')?.getAttribute('aria-expanded') === 'true'`, 'tools open')
  await until(`document.querySelector('.secretary-ops')?.textContent.includes('Previous API review')`, 'saved conversations available')
  await click('Manager tools')
  await click('Review project')
  await until(`window.managerFixture.chatRequests.filter(request => request.purpose === 'project-review').length === 2`, 'manual inspection')
  await until(`document.querySelectorAll('.secretary-bubble').length >= 2 && !document.querySelector('.is-pending')`, 'manual inspection result')
  assert.equal(await evaluate(`window.managerFixture.dispatches.length`), 0, 'read-only inspection sends no CLI work')
  await click('Pause project watch')
  await evaluate(`window.managerFixture.terminalError()`)
  await delay(650)
  assert.equal(await evaluate(`window.managerFixture.chatRequests.filter(request => request.purpose === 'error-diagnosis').length`), 0, 'paused watch sends no automatic requests')
  await click('Enable project watch')
  await click('Collapse Manager sidebar')
  await until(`Boolean(document.querySelector('[aria-label="Open Manager sidebar"]'))`, 'Manager collapsed while watching')
  await until(`document.querySelector('.secretary-chat-log')?.textContent.includes('Error diagnosis:')`, 'automatic error diagnosis')
  assert.equal(await evaluate(`Boolean(document.querySelector('.developer-secretary.is-open'))`), true, 'a diagnosed error opens Manager to notify the developer')
  const diagnosisCount = await evaluate(`window.managerFixture.chatRequests.filter(request => request.purpose === 'error-diagnosis').length`)
  assert.equal(diagnosisCount, 1, 'one diagnosis per observed error')
  await evaluate(`window.managerFixture.terminalError()`)
  await delay(5500)
  assert.equal(await evaluate(`window.managerFixture.chatRequests.filter(request => request.purpose === 'error-diagnosis').length`), diagnosisCount, 'same error is deduplicated')
  assert.equal(await evaluate(`window.managerFixture.dispatches.length`), 0, 'error diagnosis sends no CLI work')
  await screenshot('manager-error-diagnosis', 1280, 900)
  await evaluate(`window.managerFixture.terminalReady()`)
  await send('Explain the project architecture')
  await until(`document.querySelector('.secretary-chat-log')?.textContent.includes('Aurora uses React and TypeScript.')`, 'normal chat reply')
  assert.equal(await evaluate(`document.querySelector('.manager-message-code code')?.textContent`), 'const id = request.body?.id', 'developer code formatting is rendered')
  assert.equal(await evaluate(`document.querySelector('.manager-message-content h3')?.textContent`), 'Next check', 'chat headings are rendered')
  assert.equal(await evaluate(`window.managerUnsafeMarkup`), undefined, 'assistant text never executes raw HTML')
  await screenshot('manager-developer-chat', 390, 844)
  await send('Fix the API error')
  await until(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Start work')`, 'proposed repair plan')
  assert.equal(await evaluate(`window.managerFixture.dispatches.length`), 0, 'proposed plan waits for approval')
  await click('Start work')
  await until(`window.managerFixture.dispatches.length === 1`, 'approved plan dispatch')
  await until(`document.querySelector('[aria-label="Manager work status"]')?.textContent.includes('Working on your project')`, 'running work appears in conversation')
  assert.equal(await evaluate(`window.managerFixture.savedSnapshots() >= 2`), true, 'dispatch persists session bindings')
  await evaluate(`window.managerFixture.emitFailure('The API route regression test failed at src/api/users.test.ts:18.')`)
  await until(`document.querySelector('.secretary-chat-log')?.textContent.includes('The API route regression test failed')`, 'run failure delivered to chat')
  await evaluate(`window.managerFixture.setChatFailure(true)`)
  await send('Explain the failed route test')
  await until(`document.querySelector('.secretary-chat-log')?.textContent.includes('Manager connection timed out.')`, 'provider error is visible')
  await evaluate(`window.managerFixture.setChatFailure(false)`)
  await send('Explain the test strategy')
  await until(`!document.querySelector('.is-pending') && window.managerFixture.chatRequests.at(-1)?.message === 'Explain the test strategy'`, 'chat recovers after provider error')
  await click('Open Manager settings')
  assert.equal(await evaluate(`window.managerFixture.sidebar()`), 'profile', 'settings open on demand')
  await evaluate(`window.managerFixture.setDisconnected(true)`)
  await until(`document.querySelector('.secretary-connect-panel')?.textContent.includes('Manager is not connected')`, 'disconnected setup')
  assert.equal(await evaluate(`Boolean(document.querySelector('textarea[aria-label="Message Manager"]'))`), false, 'disconnected provider has setup instead of enabled composer')
  assert.deepEqual(errors, [], 'renderer console errors')
  console.log('Manager smoke passed: four viewport sizes, compact tools, project inspection, pause/resume, deduplicated error diagnosis, chat, approval dispatch, run failure, provider retry and disconnected setup.')
  console.log('Screenshots: ' + output)
  win.destroy()
  await server.close()
  app.exit(0)
}).catch(async (error) => {
  console.error(error)
  if (win && !win.isDestroyed()) {
    const state = await evaluate(`({ text: document.body.innerText, requests: window.managerFixture?.chatRequests, subscriptions: window.managerFixture?.subscriptions() })`).catch(() => null)
    writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, state }, null, 2))
    writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG())
    console.error('Failure state: ' + join(output, 'failure.json'))
  }
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await server.close()
  app.exit(1)
})

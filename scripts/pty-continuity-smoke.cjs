// Real native PTY + host IPC in a disposable profile; no provider login or user terminal.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const esbuild = require('esbuild')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bikorch-pty-continuity-'))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let host
let client
let token
let socketPath
let sequence = 0
const sessionId = 'continuity-smoke'

async function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath)
    const pending = new Map()
    let buffer = ''
    socket.once('error', reject)
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n'); buffer = lines.pop()
      for (const line of lines) {
        if (!line) continue
        const message = JSON.parse(line)
        const operation = pending.get(message.id)
        if (operation) { pending.delete(message.id); clearTimeout(operation.timer); operation.resolve(message) }
      }
    })
    socket.on('close', () => {
      for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error('Connection closed')) }
      pending.clear()
    })
    socket.once('connect', () => resolve({
      close: () => socket.destroy(),
      request: (type, payload, secret = token) => new Promise((resolveRequest, rejectRequest) => {
        const id = String(++sequence)
        const timer = setTimeout(() => { pending.delete(id); rejectRequest(new Error('Host request timed out')) }, 5_000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        socket.write(JSON.stringify({ v: 1, id, type, ...(payload ? { payload } : {}), token: secret }) + '\n')
      })
    }))
  })
}

async function main() {
  const source = path.resolve(__dirname, '../src/main/cli/pty-host')
  const helperEntry = path.join(root, 'helpers.ts')
  fs.writeFileSync(helperEntry, `export { hostSocketPath, hostConnectionToken } from ${JSON.stringify(path.join(source, 'paths').replaceAll('\\', '/'))};`)
  const helperOut = path.join(root, 'helpers.cjs')
  await esbuild.build({ entryPoints: [helperEntry], outfile: helperOut, bundle: true, platform: 'node', format: 'cjs' })
  const helpers = require(helperOut)
  socketPath = helpers.hostSocketPath(root)
  token = helpers.hostConnectionToken(root)
  const hostOut = path.join(root, 'host.cjs')
  await esbuild.build({ entryPoints: [path.join(source, 'main.ts')], outfile: hostOut, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'native-pty', setup(build) {
      build.onResolve({ filter: /^@homebridge\/node-pty-prebuilt-multiarch$/ }, () => ({ path: require.resolve('@homebridge/node-pty-prebuilt-multiarch'), external: true }))
    } }]
  })
  let errors = ''
  host = spawn(process.execPath, [hostOut], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, BIKORCH_PTY_HOST_SOCKET: socketPath, BIKORCH_PTY_HOST_PID: path.join(root, 'host.pid'), BIKORCH_PTY_HOST_TOKEN: token } })
  host.stderr.on('data', (chunk) => { errors += chunk.toString() })
  for (let attempt = 0; attempt < 60; attempt++) {
    try { client = await connect(); break }
    catch { await delay(50) }
  }
  assert.ok(client, 'Host did not start: ' + errors)
  const cwd = path.join(root, 'User Name ü')
  fs.mkdirSync(cwd)
  const command = 'process.stdout.write("host ready\\n"); if(process.stdin.isTTY)process.stdin.setRawMode(true); process.stdin.on("data",d=>process.stdout.write("echo:"+d)); process.stdin.on("end",()=>process.exit()); setInterval(()=>{},1000)'
  const payload = { sessionId, projectId: 'original-project', kind: 'codex', accountId: 'saved-account', command: process.execPath,
    args: ['-e', command], cwd, workspaceCwd: cwd, cols: 100, rows: 24, env: { ...process.env, TERM: 'xterm-256color' } }
  const started = await client.request('spawn', payload)
  assert.equal(started.payload?.status, 'running', JSON.stringify(started))
  await client.request('write', { sessionId, data: 'checkpoint\r' })
  let replay
  for (let attempt = 0; attempt < 60; attempt++) {
    replay = await client.request('replay', { sessionId })
    if (replay.payload.outputBuffer.includes('checkpoint')) break
    await delay(50)
  }
  assert.ok(replay.payload.outputBuffer.includes('checkpoint'), 'Real PTY output was not captured')
  client.close()
  client = await connect()
  const restored = await client.request('replay', { sessionId })
  assert.equal(restored.payload.status, 'running')
  assert.equal(restored.payload.projectId, payload.projectId)
  assert.equal(restored.payload.accountId, payload.accountId)
  assert.equal(restored.payload.cwd, cwd)
  assert.ok(restored.payload.outputBuffer.includes('checkpoint'))
  assert.equal((await client.request('spawn', payload)).payload.reattached, true)
  assert.equal((await client.request('spawn', { ...payload, projectId: 'wrong-project' })).type, 'error')
  const unauthorized = await connect()
  await assert.rejects(unauthorized.request('ping', null, 'wrong-token'), /Connection closed/)
  unauthorized.close()
  assert.equal((await client.request('replay', { sessionId })).payload.status, 'running')
  await client.request('kill', { sessionId })
  console.log('PTY continuity smoke passed: real Windows/Unix IPC, native terminal, disconnect/reconnect, replay, preserved folder/account/project and private connection authentication.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (client) { await client.request('kill', { sessionId }).catch(() => {}); client.close() }
  if (host) host.kill()
  const resolved = path.resolve(root)
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('bikorch-pty-continuity-')) fs.rmSync(resolved, { recursive: true, force: true })
})

import { createHash } from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'

type WireMessage =
  | { op: 'focus'; name: string }
  | { op: 'mode'; content: boolean }
  | { op: 'ping' }
  | { op: 'down' | 'move' | 'up'; x: number; y: number }
  | { op: 'key'; key?: string; text?: string }

let child: ChildProcessWithoutNullStreams | null = null
let starting: Promise<boolean> | null = null
let binaryPath: string | null = null
let readyHandler: ((trusted: boolean) => void) | null = null
let stdoutBuffer = ''

function bridgeSourcePath(): string | null {
  const candidates = [join(process.cwd(), 'src/main/simulator/bridge.swift')]
  try {
    candidates.push(join(process.resourcesPath, 'simulator/bridge.swift'))
  } catch {
    // resourcesPath is missing in some test hosts
  }
  try {
    candidates.push(join(app.getAppPath(), 'src/main/simulator/bridge.swift'))
  } catch {
    // app is unavailable outside Electron
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function cacheDirectory(): string {
  try {
    return join(app.getPath('userData'), 'simulator')
  } catch {
    return join(tmpdir(), 'bikorch-simulator')
  }
}

function compileBridge(sourcePath: string): Promise<string> {
  const source = readFileSync(sourcePath)
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const directory = cacheDirectory()
  mkdirSync(directory, { recursive: true })
  const output = join(directory, 'Bikorch Simulator')
  const stamp = `${output}.sha`
  if (existsSync(output) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash) return Promise.resolve(output)
  const staging = `${output}.next`
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/xcrun',
      ['swiftc', '-O', '-o', staging, sourcePath],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error || !existsSync(staging)) {
          reject(new Error(String(stderr || error || 'Could not compile the simulator input bridge')))
          return
        }
        try {
          renameSync(staging, output)
          writeFileSync(stamp, hash)
        } catch (renameError) {
          reject(renameError)
          return
        }
        resolve(output)
      }
    )
  })
}

function send(message: WireMessage): void {
  if (!child || child.killed || !child.stdin.writable) return
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

async function launch(deviceName: string): Promise<boolean> {
  const source = bridgeSourcePath()
  if (!source) return false
  const binary = binaryPath && existsSync(binaryPath) ? binaryPath : await compileBridge(source)
  binaryPath = binary
  const next = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child = next
  stdoutBuffer = ''
  next.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const message = JSON.parse(line) as { op?: string; trusted?: boolean }
        if (message.op === 'ready' || message.op === 'pong') readyHandler?.(message.trusted === true)
      } catch {
        // Status lines are optional. Input does not depend on them.
      }
    }
  })
  next.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text) console.error('Simulator input bridge:', text)
  })
  next.on('exit', () => {
    if (child === next) child = null
  })
  send({ op: 'focus', name: deviceName })
  return true
}

export function startInputBridge(
  deviceName: string,
  onReady?: (trusted: boolean) => void
): Promise<boolean> {
  readyHandler = onReady ?? null
  if (process.platform !== 'darwin') return Promise.resolve(false)
  if (child && !child.killed) {
    send({ op: 'focus', name: deviceName })
    send({ op: 'ping' })
    return Promise.resolve(true)
  }
  if (!starting) {
    starting = launch(deviceName)
      .catch((error: unknown) => {
        console.error('Simulator input bridge failed:', error)
        return false
      })
      .finally(() => {
        starting = null
      })
  }
  return starting
}

export function sendSimulatorInput(message: WireMessage): void {
  send(message)
}

export function stopInputBridge(): void {
  readyHandler = null
  stdoutBuffer = ''
  const current = child
  child = null
  if (!current || current.killed) return
  current.stdin.end()
  current.kill()
}

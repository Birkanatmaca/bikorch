import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { compileHelper, helperSourcePath } from './bridge'

/** Messages for the headless helper (see headless.swift). */
export type HeadlessMessage =
  | { op: 'attach'; udid: string; fps: number }
  | { op: 'down' | 'move' | 'up'; x: number; y: number }
  | { op: 'key'; key?: string; text?: string }
  | { op: 'button'; button: 'home' | 'lock' }

export type HeadlessEvent =
  | { type: 'ready' }
  | { type: 'frame'; jpeg: Buffer }
  | { type: 'failed'; message: string }

let child: ChildProcessWithoutNullStreams | null = null

function send(message: HeadlessMessage): void {
  if (!child || child.killed || !child.stdin.writable) return
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

/**
 * Runs the device without Simulator.app: frames come from its framebuffer and
 * input goes through SimulatorKit, so nothing appears on the Mac. Reports
 * `failed` when this Xcode does not offer what the helper needs.
 */
export async function startHeadless(udid: string, onEvent: (event: HeadlessEvent) => void, fps = 30): Promise<void> {
  stopHeadless()
  if (process.platform !== 'darwin') {
    onEvent({ type: 'failed', message: 'The iOS Simulator runs on a Mac.' })
    return
  }
  const source = helperSourcePath('headless.swift')
  if (!source) {
    onEvent({ type: 'failed', message: 'The headless simulator helper is missing.' })
    return
  }
  let binary: string
  try {
    binary = await compileHelper(source, 'Bikorch Simulator Headless')
  } catch (error) {
    onEvent({ type: 'failed', message: error instanceof Error ? error.message : 'Could not build the simulator helper.' })
    return
  }
  const next = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child = next
  let buffer = ''
  let settled = false
  next.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim() || child !== next) continue
      try {
        const message = JSON.parse(line) as { op?: string; data?: string; message?: string }
        if (message.op === 'frame' && typeof message.data === 'string') {
          onEvent({ type: 'frame', jpeg: Buffer.from(message.data, 'base64') })
        } else if (message.op === 'ready') {
          settled = true
          onEvent({ type: 'ready' })
        } else if (message.op === 'headless-error') {
          settled = true
          onEvent({ type: 'failed', message: message.message ?? 'The headless simulator failed.' })
        }
      } catch {
        // Ignore partial or unknown lines.
      }
    }
  })
  next.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text) console.error('Headless simulator:', text)
  })
  next.on('exit', () => {
    if (child !== next) return
    child = null
    onEvent({ type: 'failed', message: settled ? 'The simulator helper stopped.' : 'The headless simulator could not start.' })
  })
  send({ op: 'attach', udid, fps })
}

export function headlessRunning(): boolean {
  return child !== null && !child.killed
}

export function sendHeadless(message: HeadlessMessage): void {
  send(message)
}

export function stopHeadless(): void {
  const current = child
  child = null
  if (!current || current.killed) return
  current.stdin.end()
  current.kill()
}

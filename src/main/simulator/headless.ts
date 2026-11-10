import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { compileHelper, helperSourcePath } from './bridge'

/** Messages for the headless helper (see headless.swift). */
export type HeadlessMessage =
  | { op: 'attach'; udid: string; fps: number }
  | { op: 'down' | 'move' | 'up'; x: number; y: number }
  | { op: 'key'; key?: string; text?: string }
  | { op: 'button'; button: 'home' | 'lock' }
  | { op: 'view'; visible: boolean; maxHeight?: number }
  | { op: 'orientation'; orientation: 1 | 3 | 4 }

export type HeadlessEvent =
  | { type: 'ready' }
  | { type: 'frame'; jpeg: Buffer }
  | { type: 'failed'; message: string }

let child: ChildProcessWithoutNullStreams | null = null

const MESSAGE_JSON = 0x4a
const MESSAGE_FRAME = 0x46
const HEADER_BYTES = 5

/**
 * Splits the helper's stdout into messages: one type byte, a 4-byte big-endian
 * length, then the payload. Frames arrive as raw JPEG bytes.
 */
export class HelperMessageReader {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer, onMessage: (type: number, payload: Buffer) => void): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32BE(1)
      if (this.buffer.length < HEADER_BYTES + length) return
      const type = this.buffer[0]
      const payload = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length)
      this.buffer = this.buffer.subarray(HEADER_BYTES + length)
      onMessage(type, payload)
    }
  }
}

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
  const reader = new HelperMessageReader()
  let settled = false
  next.stdout.on('data', (chunk: Buffer) => {
    reader.push(chunk, (type, payload) => {
      if (child !== next) return
      if (type === MESSAGE_FRAME) {
        onEvent({ type: 'frame', jpeg: payload })
        return
      }
      if (type !== MESSAGE_JSON) return
      try {
        const message = JSON.parse(payload.toString('utf8')) as { op?: string; message?: string }
        if (message.op === 'ready') {
          settled = true
          onEvent({ type: 'ready' })
        } else if (message.op === 'headless-error') {
          settled = true
          onEvent({ type: 'failed', message: message.message ?? 'The headless simulator failed.' })
        }
      } catch {
        // Ignore unknown messages.
      }
    })
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

import { BrowserWindow } from 'electron'
import { basename } from 'path'
import { inspect } from 'util'
import { LOGS_IPC, type AppLogEntry, type AppLogLevel, type LogEvent } from '@shared/contracts/logs'

const MAX_LOG_ENTRIES = 1000
const MAX_LOG_MESSAGE_LENGTH = 8000

let nextLogId = 1
let entries: AppLogEntry[] = []
let consoleCaptureInstalled = false

type ConsoleMethod = (...args: unknown[]) => void

function formatValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`
  }

  if (typeof value === 'string') return value
  if (typeof value === 'undefined') return 'undefined'

  try {
    return inspect(value, { depth: 4, colors: false, breakLength: 120 })
  } catch {
    return String(value)
  }
}

function formatArguments(args: unknown[]): string {
  return args.map(formatValue).join(' ').slice(0, MAX_LOG_MESSAGE_LENGTH)
}

function broadcast(event: LogEvent): void {
  let windows: BrowserWindow[]
  try {
    windows = BrowserWindow.getAllWindows()
  } catch {
    return
  }

  for (const window of windows) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(LOGS_IPC.EVENT, event)
    } catch {
      // A window can disappear between getAllWindows and send.
    }
  }
}

function append(level: AppLogLevel, message: string, source: string): AppLogEntry {
  const entry: AppLogEntry = {
    id: nextLogId++,
    timestamp: Date.now(),
    level,
    source,
    message: message.slice(0, MAX_LOG_MESSAGE_LENGTH)
  }

  entries = [...entries, entry].slice(-MAX_LOG_ENTRIES)
  broadcast({ type: 'entry', entry })
  return entry
}

export function recordLog(level: AppLogLevel, message: string, source = 'main'): AppLogEntry {
  return append(level, message, source)
}

export function getLogs(limit = 500): AppLogEntry[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_LOG_ENTRIES)
  return entries.slice(-safeLimit)
}

export function clearLogs(): void {
  entries = []
  broadcast({ type: 'clear' })
}

export function recordRendererConsole(
  level: number,
  message: string,
  sourceId = ''
): AppLogEntry {
  const logLevel: AppLogLevel = level >= 3 ? 'error' : level === 2 ? 'warn' : level === 0 ? 'debug' : 'info'
  const source = sourceId ? `renderer · ${basename(sourceId)}` : 'renderer'
  return append(logLevel, message, source)
}

export function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return
  consoleCaptureInstalled = true

  const consoleObject = console as unknown as Record<string, ConsoleMethod>
  const methods: Array<[string, AppLogLevel]> = [
    ['debug', 'debug'],
    ['info', 'info'],
    ['log', 'info'],
    ['warn', 'warn'],
    ['error', 'error']
  ]

  for (const [method, level] of methods) {
    const original = consoleObject[method]?.bind(console)
    if (!original) continue

    consoleObject[method] = (...args: unknown[]) => {
      original(...args)
      append(level, formatArguments(args), 'main')
    }
  }
}

export const SIMULATOR_IPC = {
  ATTACH: 'simulator:attach',
  DETACH: 'simulator:detach',
  POINTER: 'simulator:pointer',
  KEY: 'simulator:key',
  OPEN_ACCESSIBILITY: 'simulator:open-accessibility',
  EVENT: 'simulator:event'
} as const

export type SimulatorPhase = 'starting' | 'live' | 'unavailable'

export type SimulatorFeed = 'window' | 'screen'

export interface SimulatorStatus {
  phase: SimulatorPhase
  message: string
  deviceName?: string
  mode?: SimulatorFeed
  /** False until macOS Accessibility is allowed for taps and the keyboard. */
  inputReady?: boolean
}

export interface SimulatorPointer {
  phase: 'down' | 'move' | 'up'
  x: number
  y: number
}

export interface SimulatorKey {
  text?: string
  key?: string
}

export type SimulatorClientEvent =
  | { type: 'status'; status: SimulatorStatus }
  | { type: 'frame'; jpeg: Uint8Array }

const POINTER_PHASES = new Set<SimulatorPointer['phase']>(['down', 'move', 'up'])
const KEYS = new Set([
  'enter',
  'backspace',
  'escape',
  'tab',
  'space',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright'
])

function unit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function parsePointer(raw: unknown): SimulatorPointer | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as { phase?: unknown; x?: unknown; y?: unknown }
  if (typeof record.phase !== 'string' || !POINTER_PHASES.has(record.phase as SimulatorPointer['phase'])) return null
  if (typeof record.x !== 'number' || typeof record.y !== 'number') return null
  if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return null
  return {
    phase: record.phase as SimulatorPointer['phase'],
    x: unit(record.x),
    y: unit(record.y)
  }
}

export function parseKey(raw: unknown): SimulatorKey | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as { text?: unknown; key?: unknown }
  if (typeof record.key === 'string' && KEYS.has(record.key)) return { key: record.key }
  if (typeof record.text !== 'string') return null
  const text = Array.from(record.text).slice(0, 8).join('')
  if (!text || Array.from(text).some((char) => char.charCodeAt(0) < 32)) return null
  return { text }
}

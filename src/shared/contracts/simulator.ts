export const SIMULATOR_IPC = {
  ATTACH: 'simulator:attach',
  DETACH: 'simulator:detach',
  POINTER: 'simulator:pointer',
  KEY: 'simulator:key',
  BUTTON: 'simulator:button',
  OPEN_ACCESSIBILITY: 'simulator:open-accessibility',
  /** Whether the panel shows the screen right now, and how tall in device pixels. */
  VIEW: 'simulator:view',
  /** Turn the device: landscape for games, portrait again. */
  ROTATE: 'simulator:rotate',
  EVENT: 'simulator:event',
  /** An app was installed on a simulator (an agent's build): main → renderer. */
  APP_INSTALLED: 'simulator:app-installed'
} as const

export type SimulatorPhase = 'starting' | 'live' | 'unavailable'

/** window: Simulator.app window stream; screen: simctl screenshots; device: headless framebuffer. */
export type SimulatorFeed = 'window' | 'screen' | 'device'

export type SimulatorButton = 'home' | 'lock'

export interface SimulatorStatus {
  phase: SimulatorPhase
  message: string
  deviceName?: string
  mode?: SimulatorFeed
  /** False until macOS Accessibility is allowed for taps and the keyboard. */
  inputReady?: boolean
  /** How far the device is turned, clockwise, as the panel shows it. */
  rotation?: SimulatorRotation
}

/**
 * Degrees the device is turned clockwise. 270 is turned left (landscape with
 * the top on the left), 90 turned right. Upside down is left out: Face ID
 * iPhones do not turn their interface that way.
 */
export type SimulatorRotation = 0 | 90 | 270

export function parseRotation(raw: unknown): SimulatorRotation | null {
  return raw === 0 || raw === 90 || raw === 270 ? raw : null
}

/** One step left (counter-clockwise) or right, stopping at landscape. */
export function turnDevice(rotation: SimulatorRotation, direction: 'left' | 'right'): SimulatorRotation {
  if (direction === 'left') return rotation === 90 ? 0 : 270
  return rotation === 270 ? 0 : 90
}

/**
 * The GraphicsServices orientation the device is sent. Turning the device left
 * puts it in interface landscape-right (3), turning it right landscape-left (4).
 */
export function deviceOrientationValue(rotation: SimulatorRotation): 1 | 3 | 4 {
  return rotation === 270 ? 3 : rotation === 90 ? 4 : 1
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

export interface SimulatorView {
  visible: boolean
  /** Device pixels the screen is shown at; frames are encoded no larger. */
  height: number
}

export function parseView(raw: unknown): SimulatorView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as { visible?: unknown; height?: unknown }
  if (typeof record.visible !== 'boolean') return null
  if (typeof record.height !== 'number' || !Number.isFinite(record.height)) return null
  return { visible: record.visible, height: Math.round(Math.min(2400, Math.max(320, record.height))) }
}

export function parseButton(raw: unknown): SimulatorButton | null {
  return raw === 'home' || raw === 'lock' ? raw : null
}

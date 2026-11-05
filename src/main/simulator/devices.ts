export const BIKORCH_IPHONE_NAME = 'Bikorch iPhone'

export class SimulatorUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimulatorUnavailable'
  }
}

export interface SimDeviceRecord {
  name: string
  udid: string
  state: string
  available: boolean
  deviceType: string
}

export interface SimRuntimeRecord {
  identifier: string
  name: string
  platform: string
  available: boolean
}

export type SimulatorChoice =
  | { action: 'use'; udid: string; name: string; state: string }
  | { action: 'create'; name: typeof BIKORCH_IPHONE_NAME; deviceType: string; runtime: string }
  | { action: 'unavailable'; message: string }

const PREFERRED_TYPES = [
  'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
  'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
  'com.apple.CoreSimulator.SimDeviceType.iPhone-15',
  'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
  'com.apple.CoreSimulator.SimDeviceType.iPhone-14'
]

const UDID_PATTERN = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/

export function isSimulatorUdid(value: string): boolean {
  return UDID_PATTERN.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function isIphone(device: SimDeviceRecord): boolean {
  return /iphone/i.test(device.name) || device.deviceType.includes('iPhone')
}

export function parseDeviceList(json: unknown): SimDeviceRecord[] {
  const devices = asRecord(asRecord(json)?.devices)
  if (!devices) return []
  const records: SimDeviceRecord[] = []
  for (const value of Object.values(devices)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      const record = asRecord(item)
      if (!record) continue
      const udid = typeof record.udid === 'string' ? record.udid : ''
      const name = typeof record.name === 'string' ? record.name : ''
      if (!isSimulatorUdid(udid) || !name) continue
      records.push({
        name,
        udid,
        state: typeof record.state === 'string' ? record.state : 'Shutdown',
        available: record.isAvailable !== false,
        deviceType: typeof record.deviceTypeIdentifier === 'string' ? record.deviceTypeIdentifier : ''
      })
    }
  }
  return records
}

export function parseRuntimes(json: unknown): SimRuntimeRecord[] {
  const list = asRecord(json)?.runtimes
  if (!Array.isArray(list)) return []
  const records: SimRuntimeRecord[] = []
  for (const item of list) {
    const record = asRecord(item)
    if (!record) continue
    const identifier = typeof record.identifier === 'string' ? record.identifier : ''
    if (!identifier) continue
    records.push({
      identifier,
      name: typeof record.name === 'string' ? record.name : identifier,
      platform: typeof record.platform === 'string' ? record.platform : '',
      available: record.isAvailable !== false
    })
  }
  return records
}

export function parseDeviceTypes(json: unknown): string[] {
  const list = asRecord(json)?.devicetypes
  if (!Array.isArray(list)) return []
  const identifiers: string[] = []
  for (const item of list) {
    const record = asRecord(item)
    const identifier = record && typeof record.identifier === 'string' ? record.identifier : ''
    if (identifier) identifiers.push(identifier)
  }
  return identifiers
}

export function chooseSimulator(input: {
  devices: SimDeviceRecord[]
  runtimes: SimRuntimeRecord[]
  deviceTypes: string[]
}): SimulatorChoice {
  const iphones = input.devices.filter((device) => device.available && isIphone(device))
  const rank = (device: SimDeviceRecord): number => {
    if (device.state === 'Booted') return 0
    if (device.state === 'Booting') return 1
    if (device.name === BIKORCH_IPHONE_NAME) return 2
    return 3
  }
  const chosen = [...iphones].sort(
    (left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name)
  )[0]
  if (chosen) return { action: 'use', udid: chosen.udid, name: chosen.name, state: chosen.state }

  const runtime = [...input.runtimes].reverse().find((item) => item.available && item.platform === 'iOS')
  if (!runtime) {
    return {
      action: 'unavailable',
      message: 'Xcode has no iOS simulator runtime. Open Xcode and finish the iOS simulator download.'
    }
  }
  const deviceType =
    PREFERRED_TYPES.find((type) => input.deviceTypes.includes(type)) ??
    input.deviceTypes.find((type) => type.includes('.iPhone-'))
  if (!deviceType) {
    return { action: 'unavailable', message: 'Xcode has no iPhone simulator device type.' }
  }
  return { action: 'create', name: BIKORCH_IPHONE_NAME, deviceType, runtime: runtime.identifier }
}

import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BIKORCH_IPHONE_NAME,
  chooseSimulator,
  isSimulatorUdid,
  parseDeviceList,
  parseDeviceTypes,
  parseRuntimes,
  SimulatorUnavailable,
  type SimulatorChoice
} from './devices'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

let simctlPath: string | null = null

function run(bin: string, args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const coded = error as { code?: unknown; killed?: boolean } | null
      if (coded?.killed) {
        reject(new SimulatorUnavailable('Simulator command timed out'))
        return
      }
      if (typeof coded?.code === 'string') {
        reject(new SimulatorUnavailable('Xcode is not installed. Install Xcode to run the iOS Simulator in Bikorch.'))
        return
      }
      resolve({
        code: typeof coded?.code === 'number' ? coded.code : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '')
      })
    })
  })
}

export async function resolveSimctl(): Promise<string> {
  if (simctlPath && existsSync(simctlPath)) return simctlPath
  const result = await run('/usr/bin/xcrun', ['-f', 'simctl'], 15_000)
  const path = result.stdout.trim().split('\n').filter(Boolean).pop() ?? ''
  if (result.code !== 0 || !path || !existsSync(path)) {
    throw new SimulatorUnavailable('Xcode is not installed. Install Xcode to run the iOS Simulator in Bikorch.')
  }
  simctlPath = path
  return path
}

async function listJson(simctl: string, kind: 'devices' | 'runtimes' | 'devicetypes'): Promise<unknown> {
  const args = kind === 'devices' ? ['list', 'devices', 'available', '-j'] : ['list', kind, '-j']
  const result = await run(simctl, args, 20_000)
  if (result.code !== 0) {
    throw new SimulatorUnavailable(result.stderr.trim() || 'Could not list iOS simulators')
  }
  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    throw new SimulatorUnavailable('Could not read the iOS simulator list')
  }
}

export async function ensureIphone(simctl: string): Promise<{ udid: string; name: string; state: string }> {
  const [devices, runtimes, deviceTypes] = await Promise.all([
    listJson(simctl, 'devices'),
    listJson(simctl, 'runtimes'),
    listJson(simctl, 'devicetypes')
  ])
  const choice: SimulatorChoice = chooseSimulator({
    devices: parseDeviceList(devices),
    runtimes: parseRuntimes(runtimes),
    deviceTypes: parseDeviceTypes(deviceTypes)
  })
  if (choice.action === 'unavailable') throw new SimulatorUnavailable(choice.message)
  if (choice.action === 'use') return { udid: choice.udid, name: choice.name, state: choice.state }

  const created = await run(simctl, ['create', BIKORCH_IPHONE_NAME, choice.deviceType, choice.runtime], 60_000)
  const udid = created.stdout.split('\n').map((line) => line.trim()).find((line) => isSimulatorUdid(line)) ?? ''
  if (created.code !== 0 || !udid) {
    throw new SimulatorUnavailable(created.stderr.trim() || 'Could not create an iPhone simulator')
  }
  return { udid, name: BIKORCH_IPHONE_NAME, state: 'Shutdown' }
}

/** Boots the device; true when this call started it, false when it was already running. */
export async function bootSimulator(simctl: string, udid: string): Promise<boolean> {
  const result = await run(simctl, ['boot', udid], 180_000)
  if (result.code === 0) return true
  const detail = `${result.stderr}\n${result.stdout}`
  if (/current state: Booted/i.test(detail)) return false
  throw new SimulatorUnavailable(result.stderr.trim() || 'Could not boot the iOS Simulator')
}

export async function openSimulatorApp(udid: string): Promise<void> {
  const result = await run(
    '/usr/bin/open',
    ['-g', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid],
    20_000
  )
  if (result.code !== 0) {
    throw new SimulatorUnavailable(result.stderr.trim() || 'Could not open Simulator.app')
  }
}

export async function captureSimulatorScreen(simctl: string, udid: string): Promise<Buffer | null> {
  const file = join(tmpdir(), `bikorch-ios-${udid}.jpg`)
  const result = await run(
    simctl,
    ['io', udid, 'screenshot', '--type=jpeg', '--mask=ignored', file],
    8_000
  )
  if (result.code !== 0) return null
  try {
    const bytes = readFileSync(file)
    return bytes.length > 0 ? bytes : null
  } catch {
    return null
  }
}

/** Shuts the device down. A booted iOS simulator runs hundreds of processes. */
export async function shutdownSimulator(simctl: string, udid: string): Promise<void> {
  await run(simctl, ['shutdown', udid], 60_000).catch(() => undefined)
}

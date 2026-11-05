import { execFile } from 'child_process'
import { powerMonitor } from 'electron'
import { statfs } from 'fs/promises'
import { cpus, homedir, loadavg, totalmem, freemem } from 'os'
import type { SystemMetrics, SystemProcess } from '@shared/contracts/dashboard'

/**
 * A light snapshot of this computer, taken only while the Home screen shows it.
 * Every command is a single cheap call; nothing here runs in the background.
 */

let lastTimes: { idle: number; total: number } | null = null
// Under heavy load vm_stat or ps can time out; reuse the last good reading
// instead of a misleading fallback (os.freemem counts only free pages on macOS).
let lastMemoryUsed: number | null = null
let lastProcesses: SystemProcess[] = []

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5_000, maxBuffer: 1024 * 1024 }, (_error, stdout) => resolve(String(stdout ?? '')))
  })
}

function cpuPercent(): number {
  const times = cpus().reduce(
    (sum, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
      return { idle: sum.idle + cpu.times.idle, total: sum.total + total }
    },
    { idle: 0, total: 0 }
  )
  const previous = lastTimes
  lastTimes = times
  if (!previous || times.total <= previous.total) return Math.min(100, Math.round((loadavg()[0] / Math.max(1, cpus().length)) * 100))
  const busy = 1 - (times.idle - previous.idle) / (times.total - previous.total)
  return Math.max(0, Math.min(100, Math.round(busy * 100)))
}

/** macOS counts cached files as used; "available" is free + inactive + purgeable pages. */
export function parseVmStat(output: string, total: number): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(output)?.[1])
  if (!page) return null
  const pages = (name: string): number => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(output)?.[1] ?? 0)
  const available = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') + pages('Pages purgeable')) * page
  return Math.max(0, total - available)
}

export function parseTopProcesses(output: string, limit = 5): SystemProcess[] {
  const processes: SystemProcess[] = []
  for (const line of output.split('\n').slice(1)) {
    const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const name = match[4].trim()
    if (name === 'ps') continue
    processes.push({ pid: Number(match[1]), cpuPercent: Number(match[2]), memoryBytes: Number(match[3]) * 1024, name })
    if (processes.length >= limit) break
  }
  return processes
}

/** macOS reports heat as a thermal state; anything above nominal means throttling is near. */
function thermalState(): SystemMetrics['thermal'] {
  if (process.platform !== 'darwin') return null
  try {
    const state = powerMonitor.getCurrentThermalState()
    return state === 'unknown' ? null : state
  } catch {
    return null
  }
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const mac = process.platform === 'darwin'
  const total = totalmem()
  const [vm, swap, ps, batt, disk] = await Promise.all([
    mac ? run('vm_stat', []) : Promise.resolve(''),
    mac ? run('sysctl', ['-n', 'vm.swapusage']) : Promise.resolve(''),
    run('ps', ['-Aceo', 'pid,pcpu,rss,comm', '-r']),
    mac ? run('pmset', ['-g', 'batt']) : Promise.resolve(''),
    statfs(homedir()).catch(() => null)
  ])
  const swapMatch = /used\s*=\s*([\d.]+)M/.exec(swap)
  const memoryUsed = mac ? parseVmStat(vm, total) ?? lastMemoryUsed : total - freemem()
  if (memoryUsed !== null) lastMemoryUsed = memoryUsed
  const processes = parseTopProcesses(ps, 15)
  if (processes.length > 0) lastProcesses = processes
  const battery = /(\d+)%;\s*(charging|discharging|charged|finishing charge|AC attached)/i.exec(batt)
  return {
    collectedAt: Date.now(),
    cpuPercent: cpuPercent(),
    cpus: cpus().length,
    load1: loadavg()[0],
    memory: { totalBytes: total, usedBytes: memoryUsed ?? total - freemem() },
    swapUsedBytes: swapMatch ? Math.round(Number(swapMatch[1]) * 1024 * 1024) : null,
    disk: disk ? { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize } : null,
    thermal: thermalState(),
    battery: battery ? { percent: Number(battery[1]), charging: !/discharging/i.test(battery[2]) } : null,
    topProcesses: lastProcesses
  }
}

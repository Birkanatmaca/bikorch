/**
 * Server health as the Servers dock shows it. Bikorch measures reachability
 * itself (a TCP connect to the SSH port) and reads load, memory, disk and
 * uptime over SSH with key authentication only; it never asks for a password.
 */

export type ServerHealthState =
  /** Port answers and the metrics came back. */
  | 'healthy'
  /** Port answers and metrics came back, but something is running hot. */
  | 'warning'
  /** Port answers; SSH needs a key or a first interactive sign-in for metrics. */
  | 'reachable'
  /** Nothing answers on the SSH port. */
  | 'down'

export interface ServerMetrics {
  load1: number
  load5: number
  load15: number
  cpus: number
  memTotalBytes: number
  memAvailableBytes: number
  diskTotalBytes: number
  diskUsedBytes: number
  uptimeSeconds: number
}

export interface ServerHealth {
  serverId: string
  checkedAt: number
  state: ServerHealthState
  latencyMs: number | null
  metrics: ServerMetrics | null
  /** Why metrics are missing or what runs hot, in plain words. */
  note: string | null
}

export const SERVER_HEALTH_IPC = {
  CHECK: 'servers:health-check'
} as const

/** Above these, a server is shown as warning. */
export const HEALTH_LIMITS = {
  loadPerCpu: 1.5,
  memoryUsed: 0.9,
  diskUsed: 0.9
} as const

/** Lines the remote script prints, one metric each. Linux only (/proc). */
export const REMOTE_HEALTH_SCRIPT = [
  "echo L $(cut -d' ' -f1-3 /proc/loadavg)",
  'echo C $(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)',
  "awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print \"M\", t*1024, a*1024}' /proc/meminfo",
  "df -P -k / | awk 'NR==2{print \"D\", $2*1024, $3*1024}'",
  "echo U $(cut -d. -f1 /proc/uptime)"
].join('; ')

export function parseServerMetrics(output: string): ServerMetrics | null {
  const values = new Map<string, number[]>()
  for (const line of output.split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/)
    if (!key || key.length !== 1) continue
    const numbers = rest.map(Number)
    if (numbers.length > 0 && numbers.every(Number.isFinite)) values.set(key, numbers)
  }
  const load = values.get('L')
  const cpus = values.get('C')?.[0]
  const memory = values.get('M')
  const disk = values.get('D')
  const uptime = values.get('U')?.[0]
  if (!load || load.length < 3 || !cpus || !memory || memory.length < 2 || !disk || disk.length < 2 || uptime === undefined) {
    return null
  }
  return {
    load1: load[0],
    load5: load[1],
    load15: load[2],
    cpus,
    memTotalBytes: memory[0],
    memAvailableBytes: memory[1],
    diskTotalBytes: disk[0],
    diskUsedBytes: disk[1],
    uptimeSeconds: uptime
  }
}

/** Plain-language reasons a server needs attention; empty when all is fine. */
export function healthWarnings(metrics: ServerMetrics): string[] {
  const warnings: string[] = []
  if (metrics.cpus > 0 && metrics.load5 / metrics.cpus > HEALTH_LIMITS.loadPerCpu) warnings.push('CPU is overloaded')
  if (metrics.memTotalBytes > 0 && 1 - metrics.memAvailableBytes / metrics.memTotalBytes > HEALTH_LIMITS.memoryUsed) {
    warnings.push('Memory is almost full')
  }
  if (metrics.diskTotalBytes > 0 && metrics.diskUsedBytes / metrics.diskTotalBytes > HEALTH_LIMITS.diskUsed) {
    warnings.push('Disk is almost full')
  }
  return warnings
}

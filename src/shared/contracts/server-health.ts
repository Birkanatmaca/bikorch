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

export interface ServerProcess {
  name: string
  rssBytes: number
  /** Share of one core over the process lifetime, as `ps` reports it. */
  cpuPercent: number
}

export interface ServerMetrics {
  load1: number
  load5: number
  load15: number
  cpus: number
  /** Busy share of all cores over a one-second sample, or null when unreadable. */
  cpuPercent: number | null
  memTotalBytes: number
  memAvailableBytes: number
  swapTotalBytes: number
  swapFreeBytes: number
  diskTotalBytes: number
  diskUsedBytes: number
  uptimeSeconds: number
  /** Bytes per second on physical interfaces over the same one-second sample. */
  netRxBytesPerSec: number | null
  netTxBytesPerSec: number | null
  hostname: string | null
  os: string | null
  kernel: string | null
  processes: number | null
  /** systemd units in the failed state; null without systemd. */
  failedUnits: number | null
  /** Running Docker containers; null when Docker is absent or not readable. */
  containers: number | null
  /** Largest processes by resident memory. */
  topProcesses: ServerProcess[]
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
  cpuPercent: 90,
  memoryUsed: 0.9,
  diskUsed: 0.9,
  swapUsed: 0.5
} as const

const NET_SUM =
  "awk 'NR>2{sub(/^ +/,\"\");split($0,a,/[: ]+/);if(a[1]!=\"lo\"&&a[1]!~/^(veth|docker|br-|virbr|cni|flannel|cali|tun|tap)/){r+=a[2];t+=a[10]}}END{printf \"%.0f %.0f\\n\",r,t}' /proc/net/dev"

/**
 * Lines the remote script prints, one metric each. Linux only (/proc).
 * CPU and network are two snapshots one second apart; optional lines
 * (systemd, Docker, ps) are simply absent when the tool is missing.
 */
export const REMOTE_HEALTH_SCRIPT = [
  `S1=$(head -n1 /proc/stat); N1=$(${NET_SUM}); sleep 1; S2=$(head -n1 /proc/stat); N2=$(${NET_SUM})`,
  'echo P1 $S1',
  'echo P2 $S2',
  'echo N1 $N1',
  'echo N2 $N2',
  "echo L $(cut -d' ' -f1-3 /proc/loadavg)",
  'echo C $(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)',
  "awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} /^SwapTotal:/{st=$2} /^SwapFree:/{sf=$2} END{printf \"M %.0f %.0f\\nW %.0f %.0f\\n\", t*1024, a*1024, st*1024, sf*1024}' /proc/meminfo",
  "df -P -k / | awk 'NR==2{printf \"D %.0f %.0f\\n\", $2*1024, $3*1024}'",
  'echo U $(cut -d. -f1 /proc/uptime)',
  'echo H $(cat /proc/sys/kernel/hostname 2>/dev/null)',
  'echo K $(uname -r)',
  "echo O $(grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '\"')",
  "echo Q $(ls /proc | grep -c '^[0-9]')",
  'command -v systemctl >/dev/null 2>&1 && echo F $(systemctl --failed --no-legend --plain 2>/dev/null | grep -c .)',
  "X=$(timeout 3 docker ps -q 2>/dev/null) && echo X $(printf '%s\\n' \"$X\" | grep -c .)",
  "ps -eo rss=,pcpu=,comm= --sort=-rss 2>/dev/null | head -n 5 | sed 's/^ */T /'",
  'true'
].join('; ')

function numbersOf(text: string | undefined): number[] | null {
  if (text === undefined) return null
  const numbers = text.trim().split(/\s+/).filter(Boolean).map(Number)
  return numbers.length > 0 && numbers.every(Number.isFinite) ? numbers : null
}

function textOf(text: string | undefined): string | null {
  const value = text?.trim().replace(/\s+/g, ' ').slice(0, 80)
  return value ? value : null
}

/** Busy share between two `/proc/stat` cpu lines ("cpu user nice system idle iowait …"). */
export function cpuPercentBetween(first: string | undefined, second: string | undefined): number | null {
  const read = (line: string | undefined): { total: number; idle: number } | null => {
    const numbers = numbersOf(line?.replace(/^\s*cpu\s+/, ''))
    if (!numbers || numbers.length < 4) return null
    const fields = numbers.slice(0, 8)
    return { total: fields.reduce((sum, value) => sum + value, 0), idle: fields[3] + (fields[4] ?? 0) }
  }
  const a = read(first)
  const b = read(second)
  if (!a || !b) return null
  const total = b.total - a.total
  if (total <= 0) return null
  return Math.min(100, Math.max(0, ((total - (b.idle - a.idle)) / total) * 100))
}

export function parseServerMetrics(output: string): ServerMetrics | null {
  const values = new Map<string, string>()
  const processes: ServerProcess[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([A-Z][0-9]?)(?:\s+(.*))?$/.exec(line)
    if (!match) continue
    const [, key, rest = ''] = match
    if (key === 'T') {
      const parts = /^(\d+)\s+([\d.]+)\s+(.+)$/.exec(rest.trim())
      if (parts) processes.push({ rssBytes: Number(parts[1]) * 1024, cpuPercent: Number(parts[2]), name: parts[3].trim().slice(0, 40) })
      continue
    }
    values.set(key, rest)
  }
  const load = numbersOf(values.get('L'))
  const cpus = numbersOf(values.get('C'))?.[0]
  const memory = numbersOf(values.get('M'))
  const disk = numbersOf(values.get('D'))
  const uptime = numbersOf(values.get('U'))?.[0]
  if (!load || load.length < 3 || !cpus || !memory || memory.length < 2 || !disk || disk.length < 2 || uptime === undefined) {
    return null
  }
  const swap = numbersOf(values.get('W'))
  const net1 = numbersOf(values.get('N1'))
  const net2 = numbersOf(values.get('N2'))
  const netRate = (index: number): number | null =>
    net1 && net2 && net1.length > index && net2.length > index ? Math.max(0, net2[index] - net1[index]) : null
  const count = (key: string): number | null => numbersOf(values.get(key))?.[0] ?? null
  return {
    load1: load[0],
    load5: load[1],
    load15: load[2],
    cpus,
    cpuPercent: cpuPercentBetween(values.get('P1'), values.get('P2')),
    memTotalBytes: memory[0],
    memAvailableBytes: memory[1],
    swapTotalBytes: swap?.[0] ?? 0,
    swapFreeBytes: swap?.[1] ?? 0,
    diskTotalBytes: disk[0],
    diskUsedBytes: disk[1],
    uptimeSeconds: uptime,
    netRxBytesPerSec: netRate(0),
    netTxBytesPerSec: netRate(1),
    hostname: textOf(values.get('H')),
    os: textOf(values.get('O')),
    kernel: textOf(values.get('K')),
    processes: count('Q'),
    failedUnits: count('F'),
    containers: count('X'),
    topProcesses: processes.slice(0, 5)
  }
}

/** Plain-language reasons a server needs attention; empty when all is fine. */
export function healthWarnings(metrics: ServerMetrics): string[] {
  const warnings: string[] = []
  const loadRatio = metrics.cpus > 0 ? metrics.load5 / metrics.cpus : 0
  // A one-second CPU sample spikes easily; only trust it when load agrees.
  const busy = metrics.cpuPercent !== null && metrics.cpuPercent > HEALTH_LIMITS.cpuPercent && loadRatio > 1
  if (loadRatio > HEALTH_LIMITS.loadPerCpu || busy) warnings.push('CPU is overloaded')
  if (metrics.memTotalBytes > 0 && 1 - metrics.memAvailableBytes / metrics.memTotalBytes > HEALTH_LIMITS.memoryUsed) {
    warnings.push('Memory is almost full')
  }
  if (metrics.swapTotalBytes > 0 && 1 - metrics.swapFreeBytes / metrics.swapTotalBytes > HEALTH_LIMITS.swapUsed) {
    warnings.push('Swapping heavily')
  }
  if (metrics.diskTotalBytes > 0 && metrics.diskUsedBytes / metrics.diskTotalBytes > HEALTH_LIMITS.diskUsed) {
    warnings.push('Disk is almost full')
  }
  if (metrics.failedUnits) warnings.push(`${metrics.failedUnits} service${metrics.failedUnits === 1 ? '' : 's'} failed`)
  return warnings
}

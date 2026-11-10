import { useId, useState } from 'react'
import { ArrowDown, ArrowUp, Box, ChevronDown, Cpu, HardDrive, MemoryStick, Network, TriangleAlert } from 'lucide-react'
import type { ServerHealth, ServerHealthState, ServerMetrics } from '@shared/contracts/server-health'
import type { ServerHealthSample } from '@renderer/stores/server-health-store'
import { HISTORY_LIMIT } from '@renderer/stores/server-health-store'
import { cn } from '@renderer/lib/utils'

const STATE_LABEL: Record<ServerHealthState, string> = {
  healthy: 'Healthy',
  warning: 'Needs attention',
  reachable: 'Online',
  down: 'Down'
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  if (days > 0) return `${days}d up`
  const hours = Math.floor(seconds / 3_600)
  if (hours > 0) return `${hours}h up`
  return `${Math.max(1, Math.floor(seconds / 60))}m up`
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 ** 3) return `${(bytesPerSec / 1024 ** 3).toFixed(1)} GB/s`
  if (bytesPerSec >= 1024 ** 2) return `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`
  return `${Math.round(bytesPerSec)} B/s`
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatAgo(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return formatClock(at)
}

function percent(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0
}

/** CPU busy share from the one-second sample, else load against cores. */
export function cpuUsage(metrics: ServerMetrics): number {
  if (metrics.cpuPercent !== null) return Math.round(metrics.cpuPercent)
  return percent(metrics.load5, metrics.cpus)
}

export function memoryUsage(metrics: ServerMetrics): number {
  return percent(metrics.memTotalBytes - metrics.memAvailableBytes, metrics.memTotalBytes)
}

export function diskUsage(metrics: ServerMetrics): number {
  return percent(metrics.diskUsedBytes, metrics.diskTotalBytes)
}

function heat(value: number): string {
  return value >= 90 ? 'is-hot' : value >= 70 ? 'is-warm' : 'is-ok'
}

function Meter({ label, value, detail, title }: { label: string; value: number; detail?: string; title: string }): React.JSX.Element {
  return (
    <div className="health-meter" title={title}>
      <span className="health-meter-label">{label}</span>
      <span className="health-meter-track">
        <span className={heat(value)} style={{ width: `${value}%` }} />
      </span>
      <span className="health-meter-value">{value}%</span>
      {detail && <span className="health-meter-detail">{detail}</span>}
    </div>
  )
}

export function HealthDot({ health, checking }: { health: ServerHealth | undefined; checking?: boolean }): React.JSX.Element {
  const state = health?.state
  return (
    <span
      className={cn('health-dot', state ? `is-${state}` : 'is-unknown', checking && 'is-checking')}
      title={state ? STATE_LABEL[state] : 'Not checked yet'}
      aria-label={state ? STATE_LABEL[state] : 'Not checked yet'}
    />
  )
}

/**
 * The last half hour of one measure as a thin line. Samples sit in fixed
 * one-minute slots from the right, so a fresh server's line grows leftward.
 * Hovering reads the value and time of the nearest sample.
 */
export function TrendLine({
  label,
  samples,
  pick,
  format,
  max
}: {
  label: string
  samples: ServerHealthSample[]
  pick: (sample: ServerHealthSample) => number | null
  format: (value: number) => string
  /** Fixed top of the scale (100 for percentages); otherwise the largest sample. */
  max?: number
}): React.JSX.Element {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const width = 100
  const height = 28
  const offset = HISTORY_LIMIT - samples.length
  const points = samples
    .map((sample, index) => ({ index, value: pick(sample), at: sample.at }))
    .filter((point): point is { index: number; value: number; at: number } => point.value !== null)
  const top = max ?? Math.max(1, ...points.map((point) => point.value)) * 1.15
  const x = (index: number): number => ((index + offset) / (HISTORY_LIMIT - 1)) * width
  const y = (value: number): number => height - 2 - (Math.min(value, top) / top) * (height - 4)
  const line = points.map((point) => `${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ')
  const latest = points.at(-1)
  const focused = hover !== null ? points.find((point) => point.index === hover) ?? null : null
  const shown = focused ?? latest

  const onMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    const slot = Math.round(((event.clientX - box.left) / box.width) * (HISTORY_LIMIT - 1)) - offset
    if (points.length === 0) return
    const nearest = points.reduce((best, point) => (Math.abs(point.index - slot) < Math.abs(best.index - slot) ? point : best))
    setHover(nearest.index)
  }

  return (
    <div className="health-trend">
      <div className="health-trend-head">
        <span>{label}</span>
        <span className="health-trend-value">
          {shown ? format(shown.value) : '—'}
          {focused && <small>{formatClock(focused.at)}</small>}
        </span>
      </div>
      {points.length < 2 ? (
        <div className="health-trend-empty">Collecting · one point a minute</div>
      ) : (
        <svg
          className="health-trend-plot"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}, last ${points.length} checks, now ${latest ? format(latest.value) : 'unknown'}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="health-trend-base" x1="0" x2={width} y1={height - 1} y2={height - 1} />
          <polygon
            fill={`url(#${gradientId})`}
            points={`${x(points[0].index).toFixed(2)},${height} ${line} ${x(points[points.length - 1].index).toFixed(2)},${height}`}
          />
          <polyline className="health-trend-line" points={line} fill="none" />
          {focused && <line className="health-trend-cursor" x1={x(focused.index)} x2={x(focused.index)} y1="0" y2={height} />}
        </svg>
      )}
    </div>
  )
}

function HealthFacts({ health, metrics }: { health: ServerHealth; metrics: ServerMetrics | null }): React.JSX.Element {
  return (
    <div className="health-facts">
      <span className={cn('health-state', `is-${health.state}`)}>{STATE_LABEL[health.state]}</span>
      {health.latencyMs !== null && <span>{health.latencyMs} ms</span>}
      {metrics && <span>{formatUptime(metrics.uptimeSeconds)}</span>}
      <span className="health-facts-ago" title={`Checked at ${formatClock(health.checkedAt)}`}>{formatAgo(health.checkedAt)}</span>
    </div>
  )
}

function SystemLine({ metrics }: { metrics: ServerMetrics }): React.JSX.Element | null {
  const parts = [metrics.os, metrics.kernel && `kernel ${metrics.kernel}`, `${metrics.cpus} cores`].filter(Boolean)
  return (
    <p className="health-system" title={[metrics.hostname, ...parts].filter(Boolean).join(' · ')}>
      {parts.join(' · ')}
    </p>
  )
}

function HealthChips({ metrics }: { metrics: ServerMetrics }): React.JSX.Element {
  return (
    <div className="health-chips">
      {metrics.netRxBytesPerSec !== null && metrics.netTxBytesPerSec !== null && (
        <span className="health-chip" title="Network traffic over a one-second sample">
          <ArrowDown className="h-2.5 w-2.5" aria-hidden />{formatRate(metrics.netRxBytesPerSec)}
          <ArrowUp className="h-2.5 w-2.5" aria-hidden />{formatRate(metrics.netTxBytesPerSec)}
        </span>
      )}
      <span className="health-chip" title="Load average over 1, 5 and 15 minutes">
        Load {metrics.load1.toFixed(2)} · {metrics.load5.toFixed(2)} · {metrics.load15.toFixed(2)}
      </span>
      {metrics.processes !== null && <span className="health-chip">{metrics.processes} processes</span>}
      {metrics.containers !== null && (
        <span className="health-chip" title="Running Docker containers">
          <Box className="h-2.5 w-2.5" aria-hidden />{metrics.containers}
        </span>
      )}
      {metrics.failedUnits !== null && metrics.failedUnits > 0 && (
        <span className="health-chip is-warn" title="systemctl --failed">
          <TriangleAlert className="h-2.5 w-2.5" aria-hidden />{metrics.failedUnits} failed
        </span>
      )}
    </div>
  )
}

function TopProcesses({ metrics }: { metrics: ServerMetrics }): React.JSX.Element | null {
  if (metrics.topProcesses.length === 0) return null
  const largest = Math.max(1, ...metrics.topProcesses.map((process) => process.rssBytes))
  return (
    <div className="health-procs">
      <span className="health-procs-title">Largest by memory</span>
      {metrics.topProcesses.map((process, index) => (
        <div key={`${process.name}-${index}`} className="health-proc" title={`${process.cpuPercent.toFixed(1)}% CPU over its lifetime`}>
          <span className="health-proc-name">{process.name}</span>
          <span className="health-proc-bar"><i style={{ width: `${(process.rssBytes / largest) * 100}%` }} /></span>
          <span className="health-proc-value">{formatSize(process.rssBytes)}</span>
        </div>
      ))}
    </div>
  )
}

/** Dock card body: state, meters, chips and, on demand, trends and processes. */
export function ServerHealthDetails({
  health,
  history = []
}: {
  health: ServerHealth | undefined
  history?: ServerHealthSample[]
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (!health) return <p className="health-note">Checking…</p>
  const metrics = health.metrics
  const swapUsed = metrics ? metrics.swapTotalBytes - metrics.swapFreeBytes : 0
  return (
    <div className="health-details">
      <HealthFacts health={health} metrics={metrics} />
      {metrics && (
        <>
          <SystemLine metrics={metrics} />
          <Meter
            label="CPU"
            value={cpuUsage(metrics)}
            title={`Load ${metrics.load1.toFixed(2)} / ${metrics.load5.toFixed(2)} / ${metrics.load15.toFixed(2)} on ${metrics.cpus} cores`}
          />
          <Meter
            label="RAM"
            value={memoryUsage(metrics)}
            detail={`${formatSize(metrics.memTotalBytes - metrics.memAvailableBytes)} / ${formatSize(metrics.memTotalBytes)}`}
            title="Memory in use (excluding reclaimable cache)"
          />
          {metrics.swapTotalBytes > 0 && (
            <Meter
              label="Swap"
              value={percent(swapUsed, metrics.swapTotalBytes)}
              detail={`${formatSize(swapUsed)} / ${formatSize(metrics.swapTotalBytes)}`}
              title="Swap in use"
            />
          )}
          <Meter
            label="Disk"
            value={diskUsage(metrics)}
            detail={`${formatSize(metrics.diskTotalBytes - metrics.diskUsedBytes)} free`}
            title={`${formatSize(metrics.diskUsedBytes)} of ${formatSize(metrics.diskTotalBytes)} used on /`}
          />
          <HealthChips metrics={metrics} />
        </>
      )}
      {health.note && <p className="health-note">{health.note}</p>}
      {expanded && (
        <div className="health-more">
          {metrics && <TrendLine label="CPU" samples={history} pick={(s) => s.cpuPercent} format={(v) => `${Math.round(v)}%`} max={100} />}
          {metrics && <TrendLine label="Memory" samples={history} pick={(s) => s.memoryPercent} format={(v) => `${Math.round(v)}%`} max={100} />}
          {metrics && <TrendLine label="Network in" samples={history} pick={(s) => s.netRxBytesPerSec} format={formatRate} />}
          <TrendLine label="Latency" samples={history} pick={(s) => s.latencyMs} format={(v) => `${Math.round(v)} ms`} />
          {metrics && <TopProcesses metrics={metrics} />}
        </div>
      )}
      <button type="button" className="health-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {expanded ? 'Less' : 'Trends & processes'}
        <ChevronDown className={cn('h-3 w-3', expanded && 'is-open')} aria-hidden />
      </button>
    </div>
  )
}

function Tile({
  icon,
  label,
  value,
  sub,
  children,
  tone
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  children?: React.ReactNode
  tone?: string
}): React.JSX.Element {
  return (
    <div className={cn('health-tile', tone)}>
      <span className="health-tile-label">{icon}{label}</span>
      <strong className="health-tile-value">{value}</strong>
      {sub && <small className="health-tile-sub">{sub}</small>}
      {children}
    </div>
  )
}

/** Home widget body: four tiles with half-hour trends, then facts. */
export function ServerHealthTiles({
  health,
  history = []
}: {
  health: ServerHealth | undefined
  history?: ServerHealthSample[]
}): React.JSX.Element | null {
  if (!health) return <p className="health-note">Checking…</p>
  const metrics = health.metrics
  if (!metrics) {
    return (
      <div className="health-details">
        <HealthFacts health={health} metrics={null} />
        {health.note && <p className="health-note">{health.note}</p>}
      </div>
    )
  }
  const cpu = cpuUsage(metrics)
  const memory = memoryUsage(metrics)
  const disk = diskUsage(metrics)
  return (
    <div className="health-details">
      <HealthFacts health={health} metrics={metrics} />
      <div className="health-tiles">
        <Tile icon={<Cpu className="h-3 w-3" aria-hidden />} label="CPU" value={`${cpu}%`} sub={`load ${metrics.load5.toFixed(2)} · ${metrics.cpus} cores`} tone={heat(cpu)}>
          <TrendLine label="30 min" samples={history} pick={(s) => s.cpuPercent} format={(v) => `${Math.round(v)}%`} max={100} />
        </Tile>
        <Tile
          icon={<MemoryStick className="h-3 w-3" aria-hidden />}
          label="Memory"
          value={`${memory}%`}
          sub={`${formatSize(metrics.memTotalBytes - metrics.memAvailableBytes)} of ${formatSize(metrics.memTotalBytes)}`}
          tone={heat(memory)}
        >
          <TrendLine label="30 min" samples={history} pick={(s) => s.memoryPercent} format={(v) => `${Math.round(v)}%`} max={100} />
        </Tile>
        <Tile
          icon={<HardDrive className="h-3 w-3" aria-hidden />}
          label="Disk"
          value={`${disk}%`}
          sub={`${formatSize(metrics.diskTotalBytes - metrics.diskUsedBytes)} free of ${formatSize(metrics.diskTotalBytes)}`}
          tone={heat(disk)}
        >
          <span className="health-tile-track"><i className={heat(disk)} style={{ width: `${disk}%` }} /></span>
        </Tile>
        <Tile
          icon={<Network className="h-3 w-3" aria-hidden />}
          label="Network"
          value={metrics.netRxBytesPerSec !== null ? `↓ ${formatRate(metrics.netRxBytesPerSec)}` : '—'}
          sub={metrics.netTxBytesPerSec !== null ? `↑ ${formatRate(metrics.netTxBytesPerSec)}` : undefined}
        >
          <TrendLine label="in · 30 min" samples={history} pick={(s) => s.netRxBytesPerSec} format={formatRate} />
        </Tile>
      </div>
      <SystemLine metrics={metrics} />
      <HealthChips metrics={metrics} />
      {health.note && <p className="health-note">{health.note}</p>}
    </div>
  )
}

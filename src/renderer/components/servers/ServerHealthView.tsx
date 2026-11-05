import type { ServerHealth, ServerHealthState } from '@shared/contracts/server-health'
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

function percent(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0
}

function Meter({ label, value, title }: { label: string; value: number; title: string }): React.JSX.Element {
  return (
    <div className="health-meter" title={title}>
      <span className="health-meter-label">{label}</span>
      <span className="health-meter-track">
        <span className={cn(value >= 90 ? 'is-hot' : value >= 70 ? 'is-warm' : 'is-ok')} style={{ width: `${value}%` }} />
      </span>
      <span className="health-meter-value">{value}%</span>
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

/** Load, memory and disk meters plus latency and uptime. */
export function ServerHealthDetails({ health }: { health: ServerHealth | undefined }): React.JSX.Element | null {
  if (!health) return <p className="health-note">Checking…</p>
  const metrics = health.metrics
  return (
    <div className="health-details">
      <div className="health-facts">
        <span className={cn('health-state', `is-${health.state}`)}>{STATE_LABEL[health.state]}</span>
        {health.latencyMs !== null && <span>{health.latencyMs} ms</span>}
        {metrics && <span>{formatUptime(metrics.uptimeSeconds)}</span>}
      </div>
      {metrics && (
        <>
          <Meter
            label="CPU"
            value={percent(metrics.load5, metrics.cpus)}
            title={`Load ${metrics.load1.toFixed(2)} / ${metrics.load5.toFixed(2)} / ${metrics.load15.toFixed(2)} on ${metrics.cpus} cores`}
          />
          <Meter
            label="RAM"
            value={percent(metrics.memTotalBytes - metrics.memAvailableBytes, metrics.memTotalBytes)}
            title={`${((metrics.memTotalBytes - metrics.memAvailableBytes) / 1024 ** 3).toFixed(1)} of ${(metrics.memTotalBytes / 1024 ** 3).toFixed(1)} GB in use`}
          />
          <Meter
            label="Disk"
            value={percent(metrics.diskUsedBytes, metrics.diskTotalBytes)}
            title={`${(metrics.diskUsedBytes / 1024 ** 3).toFixed(0)} of ${(metrics.diskTotalBytes / 1024 ** 3).toFixed(0)} GB used`}
          />
        </>
      )}
      {health.note && <p className="health-note">{health.note}</p>}
    </div>
  )
}

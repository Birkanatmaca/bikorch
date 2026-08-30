import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react'
import type {
  CliUsageInfo,
  CliUsageResponse,
  CliUsageWindow
} from '@shared/contracts/usage'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import { cn } from '@renderer/lib/utils'

function formatWindow(minutes: number): string {
  if (minutes >= 10080 && minutes % 10080 === 0) return 'Weekly'
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d window`
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h window`
  return `${minutes}m window`
}

function formatReset(timestamp: number | null, resetLabel?: string | null): string {
  if (resetLabel) {
    return /^(quota|available|reset)/i.test(resetLabel) ? resetLabel : `Resets ${resetLabel}`
  }
  if (!timestamp) return 'Reset time unavailable'

  const remainingMs = timestamp * 1000 - Date.now()
  if (remainingMs <= 0) return 'Resetting soon'

  const remainingMinutes = Math.ceil(remainingMs / 60000)
  if (remainingMinutes < 60) return `Resets in ${remainingMinutes}m`

  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  return minutes > 0 ? `Resets in ${hours}h ${minutes}m` : `Resets in ${hours}h`
}

function remainingColor(remaining: number): string {
  if (remaining <= 10) return 'bg-error'
  if (remaining <= 30) return 'bg-warning'
  return 'bg-success'
}

function statusLabel(provider: CliUsageInfo): string {
  switch (provider.status) {
    case 'available':
      return 'Live'
    case 'not-installed':
      return 'Not installed'
    case 'unavailable':
      return 'Unavailable'
    case 'error':
      return 'Could not read'
  }
}

function StatusIcon({ status }: { status: CliUsageInfo['status'] }): React.JSX.Element {
  if (status === 'available') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" />
  }
  if (status === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 text-error" />
  }
  return <ShieldAlert className="h-3.5 w-3.5 text-text-muted" />
}

function UsageWindow({ title, window }: { title: string; window: CliUsageWindow }): React.JSX.Element {
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent))

  return (
    <div className="rounded-md border border-border bg-app-bg/60 p-2">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-text-secondary">{title}</span>
        <span className="font-mono text-text-primary">{Math.round(remaining)}% left</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', remainingColor(remaining))}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-text-muted">
        <span>{formatWindow(window.windowDurationMins)}</span>
        <span>{formatReset(window.resetsAt, window.resetLabel)}</span>
      </div>
    </div>
  )
}

function ProviderCard({ provider }: { provider: CliUsageInfo }): React.JSX.Element {
  const logo = getCliLogo(provider.kind)
  const isAvailable = provider.status === 'available'

  return (
    <article className="rounded-lg border border-border bg-panel-bg p-2.5">
      <div className="flex items-center gap-2">
        {logo ? <img src={logo} alt="" className={CLI_LOGO_CLASS} /> : <div className={CLI_LOGO_CLASS} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-primary">{provider.label}</p>
          {provider.planType && (
            <p className="truncate text-[10px] capitalize text-text-muted">{provider.planType} plan</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-text-muted">
          <StatusIcon status={provider.status} />
          {statusLabel(provider)}
        </div>
      </div>

      {isAvailable && (provider.primary || provider.secondary) ? (
        <div className="mt-2 space-y-1.5">
          {provider.primary && (
            <UsageWindow title={provider.primary.label ?? 'Primary limit'} window={provider.primary} />
          )}
          {provider.secondary && (
            <UsageWindow title={provider.secondary.label ?? 'Secondary limit'} window={provider.secondary} />
          )}
          {provider.breakdown && provider.breakdown.length > 0 && (
            <div className="rounded-md border border-border bg-app-bg/60 p-2">
              <div className="mb-1.5 text-[10px] font-medium text-text-secondary">Usage breakdown</div>
              <div className="space-y-1">
                {provider.breakdown.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 font-mono text-[9px]">
                    <span className="text-text-muted">{item.label}</span>
                    <span className="text-text-primary">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {provider.credits && (
            <div className="flex items-center justify-between px-0.5 font-mono text-[9px] text-text-muted">
              <span>Credits</span>
              <span>
                {provider.credits.unlimited
                  ? 'Unlimited'
                  : provider.credits.hasCredits
                    ? provider.credits.balance ?? 'Available'
                    : 'None'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 rounded-md bg-app-bg/60 px-2 py-2 text-[10px] leading-relaxed text-text-muted">
          {provider.detail}
        </p>
      )}
    </article>
  )
}

export function LimitsPanel(): React.JSX.Element {
  const [data, setData] = useState<CliUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setData(await window.api.usage.read())
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not load CLI limits')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [refresh])

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="shrink-0 border-b border-border bg-elevated px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-medium text-text-primary">CLI Limits</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              Live account limits from installed CLIs
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md border border-border p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:opacity-50"
            title="Refresh limits"
            aria-label="Refresh limits"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        {data && (
          <div className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-text-muted">
            <Clock3 className="h-3 w-3" />
            Checked {new Date(data.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-2 text-[10px] text-error">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-2">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-lg border border-border bg-panel-bg" />
            ))}
          </div>
        ) : data ? (
          <div className="space-y-2">
            {data.providers.map((provider) => (
              <ProviderCard key={provider.kind} provider={provider} />
            ))}
            <p className="px-1 pt-1 text-[10px] leading-relaxed text-text-muted">
              Only values exposed by each CLI are shown. No usage is estimated locally.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

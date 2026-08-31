import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bug,
  CircleAlert,
  Info,
  Pause,
  Play,
  RefreshCw,
  Search,
  ScrollText,
  Trash2
} from 'lucide-react'
import type { AppLogEntry, AppLogLevel } from '@shared/contracts/logs'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { cn } from '@renderer/lib/utils'

type LogFilter = 'all' | AppLogLevel

const levelLabels: Record<LogFilter, string> = {
  all: 'All levels',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warnings',
  error: 'Errors'
}

const levelClasses: Record<AppLogLevel, string> = {
  debug: 'text-text-muted',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-error'
}

function levelIcon(level: AppLogLevel): React.JSX.Element {
  if (level === 'debug') return <Bug className="h-3 w-3" />
  if (level === 'warn') return <CircleAlert className="h-3 w-3" />
  if (level === 'error') return <CircleAlert className="h-3 w-3" />
  return <Info className="h-3 w-3" />
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function mergeEntries(current: AppLogEntry[], incoming: AppLogEntry[]): AppLogEntry[] {
  const byId = new Map<number, AppLogEntry>()
  for (const entry of [...current, ...incoming]) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-1000)
}

export function LogsPanel(): React.JSX.Element {
  const [entries, setEntries] = useState<AppLogEntry[]>([])
  const [filter, setFilter] = useState<LogFilter>('all')
  const [query, setQuery] = useState('')
  const [following, setFollowing] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadLogs = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.logs.get({ limit: 1000 })
      setEntries((current) => mergeEntries(current, result.entries))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.logs.onEvent((event) => {
      if (event.type === 'clear') {
        setEntries([])
        return
      }
      setEntries((current) => mergeEntries(current, [event.entry]))
    })

    void loadLogs()
    return unsubscribe
  }, [loadLogs])

  useEffect(() => {
    if (!following || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries, following])

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (filter !== 'all' && entry.level !== filter) return false
      if (!needle) return true
      return `${entry.source} ${entry.message}`.toLowerCase().includes(needle)
    })
  }, [entries, filter, query])

  const handleClear = async (): Promise<void> => {
    try {
      await window.api.logs.clear()
      setEntries([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear logs')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-elevated px-2 py-2">
        <div className="relative min-w-[130px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter logs..."
            className="w-full rounded-md border border-border bg-app-bg py-1.5 pl-7 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-primary/50"
          />
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as LogFilter)}
          className="rounded-md border border-border bg-app-bg px-2 py-1.5 text-[11px] text-text-secondary outline-none focus:border-primary/50"
          aria-label="Log level filter"
        >
          {(Object.keys(levelLabels) as LogFilter[]).map((level) => (
            <option key={level} value={level}>
              {levelLabels[level]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setFollowing((value) => !value)}
          className={cn(
            'rounded-md border border-border p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary',
            following && 'border-primary/40 bg-primary/10 text-primary'
          )}
          title={following ? 'Pause automatic scrolling' : 'Follow new log entries'}
          aria-label={following ? 'Pause automatic scrolling' : 'Follow new log entries'}
        >
          {following ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => void loadLogs()}
          className="rounded-md border border-border p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
          title="Refresh logs"
          aria-label="Refresh logs"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={entries.length === 0}
          className="rounded-md border border-border p-1.5 text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          title="Clear logs"
          aria-label="Clear logs"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5 font-mono text-[10px] text-text-muted">
        <span>{visibleEntries.length} visible · {entries.length} stored</span>
        <span>{following ? 'Following' : 'Paused'}</span>
      </div>

      {error && (
        <div className="shrink-0 border-b border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
          {error}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-1.5">
        {loading && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-text-muted">
            Loading logs...
          </div>
        ) : visibleEntries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={entries.length === 0 ? 'No logs yet' : 'No matching logs'}
            description={
              entries.length === 0
                ? 'Application activity, warnings, and errors will appear here.'
                : 'Try changing the level or search filter.'
            }
          />
        ) : (
          <div className="space-y-0.5">
            {visibleEntries.map((entry) => (
              <div
                key={entry.id}
                className="group rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-hover/50"
              >
                <div className="flex items-start gap-2 font-mono text-[10px] leading-relaxed">
                  <span className="shrink-0 text-text-muted">{formatTime(entry.timestamp)}</span>
                  <span className={cn('flex shrink-0 items-center gap-1 uppercase', levelClasses[entry.level])}>
                    {levelIcon(entry.level)}
                    {entry.level}
                  </span>
                  <span className="max-w-[150px] shrink-0 truncate text-text-muted" title={entry.source}>
                    {entry.source}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-words text-text-secondary">
                    {entry.message || '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, LoaderCircle, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { CleanupAdvice } from '@shared/contracts/dashboard'
import {
  STORAGE_SAFETY_COPY,
  type StorageCleanResult,
  type StorageItem,
  type StorageReport
} from '@shared/contracts/storage'
import { cn } from '@renderer/lib/utils'
import { formatBytes } from './charts'

/**
 * Home's system care: the storage scan plus Claude's read of it. Claude says
 * whether a cleanup is worth it and preselects what to clean; nothing is
 * deleted until the user confirms. Cleaning goes through the storage cleaner,
 * which only accepts ids from its own scan.
 */

type Phase =
  | { kind: 'scanning' }
  | { kind: 'thinking' }
  | { kind: 'ready' }
  | { kind: 'confirm' }
  | { kind: 'cleaning' }
  | { kind: 'error'; message: string }

// Kept across Home visits; a fresh scan is one click away.
let cachedReport: StorageReport | null = null
let cachedAdvice: CleanupAdvice | null = null
let cachedResults: StorageCleanResult[] | null = null

function sum(items: StorageItem[]): number {
  return items.reduce((total, item) => total + item.bytes, 0)
}

function itemTitle(item: StorageItem): string {
  return item.project ? `${item.project} · ${item.label}` : item.label
}

export function SystemCare({ onCleaned }: { onCleaned?: () => void }): React.JSX.Element {
  const [report, setReport] = useState<StorageReport | null>(cachedReport)
  const [advice, setAdvice] = useState<CleanupAdvice | null>(cachedAdvice)
  const [results, setResults] = useState<StorageCleanResult[] | null>(cachedResults)
  const [phase, setPhase] = useState<Phase>(cachedReport && cachedAdvice ? { kind: 'ready' } : { kind: 'scanning' })
  const [picked, setPicked] = useState<Set<string>>(() => new Set(cachedAdvice?.picks ?? []))
  const [showAll, setShowAll] = useState(false)

  const check = useCallback(async (force: boolean): Promise<void> => {
    try {
      setPhase({ kind: 'scanning' })
      const nextReport = await window.api.storage.scan()
      cachedReport = nextReport
      setReport(nextReport)
      setPhase({ kind: 'thinking' })
      const nextAdvice = await window.api.dashboard.cleanupAdvice(force ? 'force' : 'auto')
      cachedAdvice = nextAdvice
      setAdvice(nextAdvice)
      setPicked(new Set(nextAdvice?.picks ?? []))
      setPhase({ kind: 'ready' })
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Could not check this computer.' })
    }
  }, [])

  useEffect(() => {
    if (!cachedReport || !cachedAdvice) void check(false)
  }, [check])

  const byId = useMemo(() => new Map((report?.items ?? []).map((item) => [item.id, item])), [report])
  const suggested = useMemo(
    () => (advice?.picks ?? []).map((id) => byId.get(id)).filter((item): item is StorageItem => Boolean(item)),
    [advice, byId]
  )
  const listed = showAll ? report?.items ?? [] : suggested
  const chosen = [...picked].map((id) => byId.get(id)).filter((item): item is StorageItem => Boolean(item))
  const chosenBytes = sum(chosen)
  const totalBytes = sum(report?.items ?? [])
  const cautionChosen = chosen.filter((item) => item.safety === 'caution')

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clean = async (): Promise<void> => {
    setPhase({ kind: 'cleaning' })
    try {
      const done = await window.api.storage.clean(chosen.map((item) => item.id))
      cachedResults = done
      setResults(done)
      onCleaned?.()
      await check(true)
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'The cleanup did not finish.' })
    }
  }

  const freed = results?.reduce((total, result) => total + result.freedBytes, 0) ?? 0
  const failed = results?.filter((result) => !result.ok) ?? []
  const busy = phase.kind === 'scanning' || phase.kind === 'thinking' || phase.kind === 'cleaning'

  return (
    <section className={cn('home-care', advice?.recommend && 'is-recommending')} aria-live="polite">
      <header className="home-care-head">
        <span className="home-care-avatar"><Sparkles className="h-3.5 w-3.5" aria-hidden /></span>
        <span className="home-care-title">
          {phase.kind === 'scanning' ? 'Checking what can be cleaned…'
            : phase.kind === 'thinking' ? 'Claude is reading your system…'
            : phase.kind === 'cleaning' ? `Cleaning ${formatBytes(chosenBytes)}…`
            : advice?.headline ?? 'System care'}
        </span>
        <button
          type="button"
          className="home-icon-button"
          onClick={() => void check(true)}
          disabled={busy}
          title="Check again"
          aria-label="Check again"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden />
        </button>
      </header>

      {busy && (
        <div className="home-care-busy" role="status">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {phase.kind === 'scanning' && 'Measuring caches, build outputs and old worktrees. This can take a few seconds.'}
          {phase.kind === 'thinking' && report && `${formatBytes(totalBytes)} could be cleaned in total. Asking Claude what is worth it.`}
          {phase.kind === 'cleaning' && 'Removing the chosen items. Projects, source code and settings are not touched.'}
        </div>
      )}

      {phase.kind === 'error' && <p className="home-care-error">{phase.message}</p>}

      {results && !busy && (
        <p className="home-care-result">
          <Check className="h-3.5 w-3.5" aria-hidden /> Freed {formatBytes(freed)}.
          {failed.length > 0 && ` ${failed.length} item${failed.length === 1 ? '' : 's'} could not be cleaned: ${failed.map((item) => item.label).join(', ')}.`}
        </p>
      )}

      {advice && !busy && (
        <>
          <p className="home-care-message">{advice.message}</p>
          {advice.note && <p className="home-care-note">{advice.note}</p>}

          {listed.length > 0 && (
            <ul className="home-care-list">
              {listed.map((item) => (
                <li key={item.id}>
                  <label className={cn('home-care-item', picked.has(item.id) && 'is-on')} title={item.detail}>
                    <input type="checkbox" checked={picked.has(item.id)} onChange={() => toggle(item.id)} disabled={phase.kind === 'confirm'} />
                    <span className="home-care-item-name">{itemTitle(item)}</span>
                    <span className={cn('home-care-safety', `is-${item.safety}`)}>{STORAGE_SAFETY_COPY[item.safety]}</span>
                    <span className="home-care-item-size">{formatBytes(item.bytes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {report && report.items.length > suggested.length && (
            <button type="button" className="home-link-button home-care-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
              {showAll ? 'Show only Claude’s picks' : `Show all ${report.items.length} items (${formatBytes(totalBytes)})`}
            </button>
          )}

          {phase.kind === 'confirm' ? (
            <div className="home-care-confirm" role="alertdialog" aria-label="Confirm cleanup">
              <p>
                Delete {chosen.length} item{chosen.length === 1 ? '' : 's'} ({formatBytes(chosenBytes)})? This cannot be undone.
                {cautionChosen.length > 0 && ` ${cautionChosen.length} marked “Check first” may hold something you need.`}
              </p>
              <div className="home-care-actions">
                <button type="button" className="home-care-primary is-danger" onClick={() => void clean()}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Yes, clean
                </button>
                <button type="button" className="home-care-secondary" onClick={() => setPhase({ kind: 'ready' })}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="home-care-actions">
              <button
                type="button"
                className="home-care-primary"
                disabled={chosen.length === 0}
                onClick={() => setPhase({ kind: 'confirm' })}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {chosen.length === 0 ? 'Nothing selected' : `Clean ${formatBytes(chosenBytes)}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, HardDrive, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import {
  STALE_PROJECT_DAYS,
  STORAGE_GROUPS,
  STORAGE_GROUP_COPY,
  STORAGE_SAFETY_COPY,
  type StorageCleanResult,
  type StorageGroup,
  type StorageItem,
  type StorageReport
} from '@shared/contracts/storage'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { cn } from '@renderer/lib/utils'

const DAY_MS = 86_400_000
const SWAP_HINT_BYTES = 2 * 1024 ** 3

// The last scan survives closing the sidebar; scanning again is a click away.
let cachedReport: StorageReport | null = null

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function age(at: number | null): string {
  if (!at) return ''
  const days = Math.floor((Date.now() - at) / DAY_MS)
  if (days < 1) return 'used today'
  if (days < 30) return `${days} d ago`
  if (days < 365) return `${Math.floor(days / 30)} mo ago`
  return `${Math.floor(days / 365)} y ago`
}

function isStaleProjectItem(item: StorageItem): boolean {
  return item.group === 'projects' && item.lastUsedAt !== null && Date.now() - item.lastUsedAt > STALE_PROJECT_DAYS * DAY_MS
}

function sum(items: StorageItem[]): number {
  return items.reduce((total, item) => total + item.bytes, 0)
}

function ItemRow({
  item,
  checked,
  onToggle
}: {
  item: StorageItem
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  const stale = isStaleProjectItem(item)
  return (
    <li className={cn('storage-row', checked && 'is-checked')}>
      <label className="storage-row-main">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="storage-row-text">
          <span className="storage-row-label" title={item.path}>{item.label}</span>
          <span className="storage-row-meta">
            <span className={cn('storage-safety', `is-${item.safety}`)}>{STORAGE_SAFETY_COPY[item.safety]}</span>
            {item.lastUsedAt ? <span className={cn(stale && 'storage-stale')}>{age(item.lastUsedAt)}</span> : null}
          </span>
          <span className="storage-row-detail">{item.detail}</span>
        </span>
        <span className="storage-row-size">{formatBytes(item.bytes)}</span>
      </label>
      <button
        type="button"
        className="storage-reveal"
        title="Show in Finder"
        aria-label={`Show ${item.label} in Finder`}
        onClick={() => void window.api.storage.reveal(item.id)}
      >
        <FolderOpen className="h-3 w-3" aria-hidden />
      </button>
    </li>
  )
}

function GroupSection({
  group,
  items,
  selected,
  onToggle,
  onToggleAll
}: {
  group: StorageGroup
  items: StorageItem[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (ids: string[], on: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(group !== 'apps')
  const ids = items.map((item) => item.id)
  const chosen = ids.filter((id) => selected.has(id)).length
  const copy = STORAGE_GROUP_COPY[group]
  return (
    <section className="storage-group">
      <div className="storage-group-head">
        <input
          type="checkbox"
          aria-label={`Select all in ${copy.label}`}
          checked={chosen === ids.length}
          ref={(node) => {
            if (node) node.indeterminate = chosen > 0 && chosen < ids.length
          }}
          onChange={(event) => onToggleAll(ids, event.target.checked)}
        />
        <button type="button" className="storage-group-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
          <span className="storage-group-title">{copy.label}</span>
          <span className="storage-group-count">{items.length}</span>
          <span className="storage-group-size">{formatBytes(sum(items))}</span>
        </button>
      </div>
      {open && (
        <>
          <p className="storage-group-hint">{copy.description}</p>
          <ul className="storage-list">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={() => onToggle(item.id)} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Disk and cache review: scan, pick, clean. Nothing is selected for you. */
export function StoragePanel(): React.JSX.Element {
  const [report, setReport] = useState<StorageReport | null>(cachedReport)
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<StorageCleanResult[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const items = report?.items ?? []
  const groups = useMemo(
    () => STORAGE_GROUPS.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter((entry) => entry.items.length > 0),
    [items]
  )
  const chosen = items.filter((item) => selected.has(item.id))
  const chosenBytes = sum(chosen)
  const cautious = chosen.filter((item) => item.safety === 'caution')

  const scan = async (): Promise<void> => {
    setScanning(true)
    setError(null)
    try {
      const next = await window.api.storage.scan()
      cachedReport = next
      setReport(next)
      const present = new Set(next.items.map((item) => item.id))
      setSelected((current) => new Set([...current].filter((id) => present.has(id))))
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError))
    } finally {
      setScanning(false)
    }
  }

  const clean = async (): Promise<void> => {
    setConfirming(false)
    setCleaning(true)
    setError(null)
    try {
      setResults(await window.api.storage.clean(chosen.map((item) => item.id)))
      setSelected(new Set())
    } catch (cleanError) {
      setError(cleanError instanceof Error ? cleanError.message : String(cleanError))
    } finally {
      setCleaning(false)
    }
    await scan()
  }

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = (ids: string[], on: boolean): void =>
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const selectWhere = (match: (item: StorageItem) => boolean): void =>
    setSelected(new Set(items.filter(match).map((item) => item.id)))

  const freed = results ? results.reduce((total, result) => total + result.freedBytes, 0) : 0
  const failed = results?.filter((result) => !result.ok) ?? []
  const usedRatio = report?.disk ? 1 - report.disk.freeBytes / report.disk.totalBytes : 0

  return (
    <section className="storage-panel" aria-label="Storage">
      <div className="storage-summary">
        {report?.disk ? (
          <>
            <div className="storage-disk-line">
              <HardDrive className="h-3.5 w-3.5" aria-hidden />
              <span>
                <strong>{formatBytes(report.disk.freeBytes)}</strong> free of {formatBytes(report.disk.totalBytes)}
              </span>
            </div>
            <div className="storage-disk-bar" aria-hidden>
              <span className={cn(usedRatio > 0.9 && 'is-full')} style={{ width: `${Math.round(usedRatio * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="storage-intro">
            Find the caches, dependencies and build outputs that fill your disk. You choose what gets cleaned; nothing is removed without your confirmation.
          </p>
        )}
        {report?.swapUsedBytes && report.swapUsedBytes > SWAP_HINT_BYTES ? (
          <p className="storage-note">
            macOS swap uses {formatBytes(report.swapUsedBytes)}. That is memory pressure, not files: quit heavy apps or restart to give it back.
          </p>
        ) : null}
        <div className="storage-actions">
          <Button size="sm" variant={report ? 'ghost' : 'secondary'} disabled={scanning || cleaning} onClick={() => void scan()}>
            {scanning ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
            {scanning ? 'Scanning…' : report ? 'Scan again' : 'Scan storage'}
          </Button>
          {report && !scanning && (
            <span className="storage-scanned">
              {formatBytes(sum(items))} in {items.length} items · {Math.max(1, Math.round(report.durationMs / 1000))} s
            </span>
          )}
        </div>
        {report && items.length > 0 && (
          <div className="storage-quick" aria-label="Quick select">
            <button type="button" onClick={() => selectWhere((item) => item.safety === 'safe')}>Safe caches</button>
            <button type="button" onClick={() => selectWhere(isStaleProjectItem)}>Projects idle {STALE_PROJECT_DAYS}+ days</button>
            {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())}>Clear</button>}
          </div>
        )}
      </div>

      {error && (
        <div className="agent-setup-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}

      {results && (
        <div className={cn('storage-result', failed.length > 0 && 'has-failures')} role="status">
          <div className="storage-result-head">
            <span>Freed {formatBytes(freed)}{failed.length > 0 ? ` · ${failed.length} failed` : ''}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setResults(null)}>
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {failed.map((result) => (
            <p key={result.id} className="storage-result-error">
              {result.label}: {result.error}
            </p>
          ))}
        </div>
      )}

      {scanning && !report && <p className="storage-intro">Measuring folders. Large dependency folders can take a few seconds…</p>}

      {groups.map(({ group, items: groupItems }) => (
        <GroupSection
          key={group}
          group={group}
          items={groupItems}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
        />
      ))}

      {report && items.length === 0 && !scanning && <p className="storage-intro">Nothing large to clean. Your disk is tidy.</p>}

      {chosen.length > 0 && (
        <div className="storage-footer">
          <span>
            {chosen.length} selected · <strong>{formatBytes(chosenBytes)}</strong>
          </span>
          <Button size="sm" variant="danger" disabled={cleaning || scanning} onClick={() => setConfirming(true)}>
            {cleaning ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <Trash2 className="h-3 w-3" aria-hidden />}
            {cleaning ? 'Cleaning…' : 'Clean selected'}
          </Button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Clean ${chosen.length} item${chosen.length === 1 ? '' : 's'} (${formatBytes(chosenBytes)})?`}
          message={
            cautious.length > 0
              ? `These are deleted permanently, not moved to the Trash. Check first: ${cautious.map((item) => item.label).join(', ')}.`
              : 'These are deleted permanently, not moved to the Trash. Tools download or rebuild them when needed.'
          }
          confirmLabel="Clean"
          onConfirm={() => void clean()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  )
}

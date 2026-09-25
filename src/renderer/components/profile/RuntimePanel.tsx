import { useEffect, useState } from 'react'
import { Activity, Gauge, HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import {
  RESOURCE_PROFILES,
  RESOURCE_PROFILE_COPY,
  type ResourceDiskSnapshot,
  type ResourceProfile
} from '@shared/contracts/resources'
import { useResourceStore } from '@renderer/stores/resource-store'
import { currentResourceLimits } from '@renderer/lib/resource-limits'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'
import { SectionCard } from './ProfilePrimitives'
import { cn } from '@renderer/lib/utils'

function formatMb(kb: number): string {
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function RuntimePanel(): React.JSX.Element {
  const profile = useResourceStore((state) => state.profile)
  const snapshot = useResourceStore((state) => state.snapshot)
  const census = useResourceStore((state) => state.census)
  const setProfile = useResourceStore((state) => state.setProfile)
  const refreshSnapshot = useResourceStore((state) => state.refreshSnapshot)
  const limits = currentResourceLimits()
  const [hidden, setHidden] = useState(() => isDocumentHidden())
  const [disk, setDisk] = useState<ResourceDiskSnapshot | null>(null)
  const [diskBusy, setDiskBusy] = useState(false)
  const [diskMessage, setDiskMessage] = useState<string | null>(null)

  async function refreshDisk(): Promise<void> {
    const api = window.api?.resources
    if (!api) return
    setDiskBusy(true)
    try {
      setDisk(await api.diskSnapshot())
      setDiskMessage(null)
    } catch {
      setDiskMessage('Disk usage could not be measured.')
    } finally {
      setDiskBusy(false)
    }
  }

  async function clearWebCache(): Promise<void> {
    const api = window.api?.resources
    if (!api) return
    setDiskBusy(true)
    try {
      const released = await api.clearBrowserCache()
      setDisk(await api.diskSnapshot())
      setDiskMessage(`${formatBytes(released)} of browser cache released. Sign-ins and saved data were kept.`)
    } catch {
      setDiskMessage('Browser cache could not be cleared.')
    } finally {
      setDiskBusy(false)
    }
  }

  useEffect(() => {
    void refreshDisk()
  }, [])

  useEffect(() => {
    void refreshSnapshot()
    const intervalMs = hidden ? 15_000 : 3_000
    const timer = window.setInterval(() => {
      if (isDocumentHidden()) return
      void refreshSnapshot()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [hidden, refreshSnapshot])

  useEffect(() => onDocumentVisibility(setHidden), [])

  return (
    <>
      <SectionCard
        title="Resource profile"
        description="Controls idle webviews, terminal scrollback, and inactive caches. Live CLI processes are never auto-stopped."
      >
        <div className="grid gap-2">
          {RESOURCE_PROFILES.map((id) => (
            <button
              key={id}
              type="button"
              className={cn(
                'rounded-md border px-3 py-2 text-left',
                profile === id ? 'border-primary/60 bg-primary/10' : 'border-border bg-elevated'
              )}
              onClick={() => void setProfile(id as ResourceProfile)}
            >
              <strong className="block text-xs text-text-primary">{RESOURCE_PROFILE_COPY[id].label}</strong>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                {RESOURCE_PROFILE_COPY[id].description}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-text-muted">
          Chat idle {Math.round(limits.webChatIdleMs / 1000)}s · terminal scrollback {limits.terminalScrollback} ·
          CLI scrollback {limits.cliTerminalScrollback}
        </p>
      </SectionCard>

      <SectionCard
        title="Process memory"
        description="Working set from Electron. Child CLI/PTY host memory is not estimated."
        action={<Gauge className="h-3.5 w-3.5 text-text-muted" aria-hidden />}
      >
        <KeyRow
          label="Electron processes"
          value={snapshot ? formatMb(snapshot.electronWorkingSetKb) : '—'}
        />
        <KeyRow label="Process count" value={snapshot ? String(snapshot.electronProcesses.length) : '—'} />
        <KeyRow
          label="Electron CPU"
          value={snapshot ? `${snapshot.electronProcesses.reduce((sum, process) => sum + process.cpuPercent, 0).toFixed(1)}%` : '—'}
        />
        <div className="mt-2 max-h-40 overflow-auto text-[11px] text-text-secondary">
          {(snapshot?.electronProcesses ?? []).map((process) => (
            <div key={`${process.pid}-${process.type}`} className="flex justify-between gap-3 py-0.5">
              <span>
                {process.type}
                {process.name ? ` · ${process.name}` : ''} · pid {process.pid}
              </span>
              <span>{formatMb(process.workingSetKb)}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Disk footprint"
        description="Measured on demand. Account profiles, music, sign-ins and conversation data are protected."
        action={<HardDrive className="h-3.5 w-3.5 text-text-muted" aria-hidden />}
      >
        <KeyRow label="Bikorch app data" value={disk ? formatBytes(disk.appDataBytes) : '—'} />
        <KeyRow label="CLI account profiles" value={disk ? formatBytes(disk.accountProfilesBytes) : '—'} />
        <KeyRow label="Web session data" value={disk ? formatBytes(disk.browserSessionBytes) : '—'} />
        <KeyRow label="Music & downloads" value={disk ? formatBytes(disk.musicBytes) : '—'} />
        <KeyRow label="Other app data" value={disk ? formatBytes(disk.otherBytes) : '—'} />
        <div className="mt-2 border-t border-border pt-2">
          <KeyRow label="Clearable browser cache" value={disk ? formatBytes(disk.browserCacheBytes) : '—'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={diskBusy} onClick={() => void refreshDisk()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-text-secondary disabled:opacity-50">
            <RotateCcw className="h-3 w-3" aria-hidden /> {diskBusy ? 'Measuring…' : 'Refresh usage'}
          </button>
          <button type="button" disabled={diskBusy || !disk?.browserCacheBytes} onClick={() => void clearWebCache()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-text-secondary disabled:opacity-50">
            <Trash2 className="h-3 w-3" aria-hidden /> Clear browser cache
          </button>
        </div>
        {diskMessage && <p className="mt-2 text-[11px] text-text-muted" role="status">{diskMessage}</p>}
        <p className="mt-2 text-[11px] text-text-muted">
          HTTP and code caches are cleared automatically at launch only when a web partition's HTTP cache exceeds 256 MB.
          Clearing it may briefly reload web content; it does not sign you out.
        </p>
      </SectionCard>

      <SectionCard title="Runtime" action={<Activity className="h-3.5 w-3.5 text-text-muted" aria-hidden />}>
        <KeyRow
          label="Workspace database"
          value={snapshot?.workspaceDatabase.bytes == null ? '—' : formatBytes(snapshot.workspaceDatabase.bytes)}
        />
        <KeyRow
          label="DB export"
          value={snapshot ? snapshot.workspaceDatabase.pendingChanges ? 'pending' : 'idle' : '—'}
        />
        <KeyRow
          label="PTY host"
          value={
            snapshot
              ? snapshot.ptyHost.alive
                ? `alive${snapshot.ptyHost.pid ? ` · pid ${snapshot.ptyHost.pid}` : ''}${
                    snapshot.ptyHost.connected ? ' · connected' : ' · disconnected'
                  }`
                : 'not running'
              : '—'
          }
        />
        <KeyRow
          label="Host sessions"
          value={snapshot ? String(snapshot.ptyHost.runningSessions) : '—'}
        />
        <KeyRow
          label="Bound PTY sessions"
          value={snapshot ? String(snapshot.ptyManager.boundSessions) : '—'}
        />
        <KeyRow label="Monaco loaded" value={census?.monacoLoaded ? 'yes' : 'no'} />
        <KeyRow label="Live webviews" value={census ? String(census.webviewElements) : '—'} />
        <KeyRow label="Web chat guests" value={census ? String(census.webChatGuests) : '—'} />
        <KeyRow label="Browser panels" value={census ? String(census.browserPanels) : '—'} />
        <KeyRow label="Projects" value={census ? String(census.projectCount) : '—'} />
        <KeyRow label="Busy CLIs" value={census ? String(census.busyCliSessions) : '—'} />
      </SectionCard>
    </>
  )
}

function KeyRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  )
}

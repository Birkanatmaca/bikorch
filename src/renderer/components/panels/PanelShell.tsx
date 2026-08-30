import { type PanelType } from '@shared/types'
import type { PtyLaunchMode, PtySessionStatus } from '@shared/contracts/pty'
import { cn, getPanelTypeIcon } from '@renderer/lib/utils'
import { cliFrameClass, getCliChromePhase } from '@renderer/lib/cli-chrome'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { X, GripVertical, PanelLeftClose } from 'lucide-react'
import { PanelContent } from './PanelContent'

interface PanelShellProps {
  id: string
  type: PanelType
  title: string
  onClose?: () => void
  onHide?: () => void
  draggable?: boolean
  showHeader?: boolean
  flush?: boolean
  onHeaderPointerDown?: (e: React.PointerEvent) => void
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  launchMode?: PtyLaunchMode
  accountId?: string
}

const statusColors: Record<PtySessionStatus, string> = {
  starting: 'text-info',
  running: 'text-success',
  waiting: 'text-warning',
  busy: 'text-primary',
  stopped: 'text-text-muted',
  error: 'text-error'
}

const statusLabels: Record<PtySessionStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  busy: 'Working',
  stopped: 'Stopped',
  error: 'Error'
}

const PTY_PANEL_TYPES: PanelType[] = [
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
]

function usePanelStatus(panelId: string, type: PanelType): PtySessionStatus | undefined {
  const terminalStatus = useTerminalStore((s) => s.sessions[panelId])

  if (!PTY_PANEL_TYPES.includes(type)) return undefined
  return terminalStatus ?? 'starting'
}

export function PanelShell({
  id,
  type,
  title,
  onClose,
  onHide,
  draggable = true,
  showHeader = true,
  flush = false,
  onHeaderPointerDown,
  onDragStart,
  onDragEnd,
  launchMode,
  accountId
}: PanelShellProps): React.JSX.Element {
  const status = usePanelStatus(id, type)
  const phase = getCliChromePhase(type, status)
  const showChrome = !flush && phase !== 'off'
  const cliLogo = getCliLogo(type)
  const isWebChatPanel = type === 'chatgpt' || type === 'claude-chat'
  const showDragHandle = !isWebChatPanel && (draggable || Boolean(onHeaderPointerDown))

  return (
    <div
      className={cn(
        'panel-shell relative flex h-full flex-col overflow-hidden bg-panel-bg',
        flush ? 'rounded-none border-0' : 'rounded-md border border-border shadow-sm',
        showChrome && cliFrameClass(phase)
      )}
    >
      {showChrome && phase === 'busy' && <div className="cli-busy-wash" aria-hidden />}
      {showHeader && (
      <header
        className={cn(
          'relative z-[3] flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-elevated px-2 app-no-drag',
          onHeaderPointerDown && 'cursor-grab active:cursor-grabbing'
        )}
        draggable={draggable && !onHeaderPointerDown}
        onPointerDown={onHeaderPointerDown}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {showDragHandle && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        )}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center font-mono text-xs text-text-muted">
          {cliLogo ? (
            <img src={cliLogo} alt="" className={CLI_LOGO_CLASS} />
          ) : (
            getPanelTypeIcon(type)
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{title}</span>
        {status && (
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-widest',
              statusColors[status]
            )}
          >
            {status === 'running' ? '● RUNNING' : `● ${statusLabels[status].toUpperCase()}`}
          </span>
        )}
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="rounded-sm p-0.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            aria-label={`Hide ${title}`}
            title="Hide sidebar"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
        {!onHide && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-0.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            aria-label={`Close ${title}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      )}
      <div className={cn('min-h-0 flex-1 overflow-hidden', !showHeader && 'rounded-md')}>
        <PanelContent panelId={id} type={type} launchMode={launchMode} accountId={accountId} />
      </div>
    </div>
  )
}

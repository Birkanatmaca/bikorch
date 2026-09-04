import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type PanelType } from '@shared/types'
import type { PtyLaunchMode, PtySessionStatus } from '@shared/contracts/pty'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS, type AiAccount } from '@shared/contracts/accounts'
import { cn, getPanelTypeIcon } from '@renderer/lib/utils'
import { cliFrameClass, getCliChromePhase } from '@renderer/lib/cli-chrome'
import { getCliLogo } from '@renderer/lib/cli-logos'
import { isMacOS, isWindows } from '@renderer/lib/electron-api'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { Info, X, GripVertical, PanelLeftClose, Pencil, UserRound } from 'lucide-react'
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
  windowActive?: boolean
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

type AccountKind = (typeof AI_ACCOUNT_KINDS)[number]

function getAccountKind(type: PanelType): AccountKind | null {
  return AI_ACCOUNT_KINDS.includes(type as AccountKind) ? (type as AccountKind) : null
}

function formatAccountDate(timestamp: number | null): string {
  if (!timestamp) return 'Not authenticated'
  return new Date(timestamp).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

const ACCOUNT_INFO_WIDTH = 300
const ACCOUNT_INFO_GAP = 8

function placeAccountInfoPopover(anchor: DOMRect, height: number): { x: number; y: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const x = Math.min(
    Math.max(8, anchor.right - ACCOUNT_INFO_WIDTH),
    Math.max(8, vw - ACCOUNT_INFO_WIDTH - 8)
  )
  const below = anchor.bottom + ACCOUNT_INFO_GAP
  const y = below + height <= vh - 8 ? below : Math.max(8, anchor.top - height - ACCOUNT_INFO_GAP)
  return { x, y }
}

function AccountInfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="account-info-row">
      <span className="account-info-row-label">{label}</span>
      <span className="account-info-row-value">{value}</span>
    </div>
  )
}

function AccountInfoPopover({
  open,
  title,
  accountKind,
  account,
  accountId,
  anchorRef,
  onClose
}: {
  open: boolean
  title: string
  accountKind: AccountKind
  account: AiAccount | null
  accountId?: string
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}): React.JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const logo = getCliLogo(accountKind)
  const isMac = isMacOS()
  const isWin = isWindows()
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open) return

    const apply = (): void => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor || !popover) return
      const { x, y } = placeAccountInfoPopover(
        anchor.getBoundingClientRect(),
        popover.offsetHeight || 180
      )
      const next = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      if (popover.style.transform !== next) {
        popover.style.transform = next
      }
      popover.dataset.placed = 'true'
    }

    apply()
    let frame = requestAnimationFrame(function follow() {
      apply()
      frame = requestAnimationFrame(follow)
    })

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      const panel = anchorRef.current?.closest('.panel-shell')
      if (panel?.contains(target)) return
      onCloseRef.current()
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, anchorRef])

  if (!open) return null

  const displayName = account?.name ?? (accountId ? 'Account unavailable' : 'No active account')
  const ready = Boolean(account?.profileReady)

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${title} account information`}
      className={cn(
        'account-info-popover app-no-drag',
        isMac && 'account-info-popover-macos',
        isWin && 'account-info-popover-windows'
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="account-info-card">
        <div className="account-info-header">
          <div className="account-info-avatar">
            {logo ? (
              <img src={logo} alt="" className="h-5 w-5 object-contain" />
            ) : (
              <UserRound className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="account-info-name">{displayName}</p>
            <p className="account-info-kind">{AI_ACCOUNT_LABELS[accountKind]}</p>
          </div>
          <span className={cn('account-info-badge', ready ? 'is-ready' : 'is-pending')}>
            {ready ? 'Ready' : 'Not ready'}
          </span>
        </div>

        {account ? (
          <div className="account-info-group">
            <AccountInfoRow label="Email" value={account.email || 'Not provided'} />
            <AccountInfoRow label="Plan" value={account.plan || 'Not provided'} />
            <AccountInfoRow label="Signed in" value={formatAccountDate(account.lastAuthenticatedAt)} />
          </div>
        ) : (
          <p className="account-info-empty">
            This CLI has no managed account selected. It will use the session already signed in on this computer.
          </p>
        )}

        {account?.note ? <p className="account-info-note">{account.note}</p> : null}
      </div>
    </div>,
    document.body
  )
}

function MacTrafficLightControls({
  title,
  onClose,
  inactive
}: {
  title: string
  onClose: () => void
  inactive?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn('mac-traffic-lights', inactive && 'mac-traffic-lights-inactive')}
      aria-label={`${title} window controls`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="mac-traffic-light mac-traffic-light-close"
        onClick={onClose}
        aria-label={`Close ${title}`}
        title={`Close ${title}`}
      >
        <svg className="mac-traffic-light-glyph" viewBox="0 0 12 12" aria-hidden>
          <path d="M3.15 3.15l5.7 5.7M8.85 3.15l-5.7 5.7" />
        </svg>
      </button>
      <span className="mac-traffic-light mac-traffic-light-disabled" aria-hidden />
      <span className="mac-traffic-light mac-traffic-light-disabled" aria-hidden />
    </div>
  )
}

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
  accountId,
  windowActive = true
}: PanelShellProps): React.JSX.Element {
  const status = usePanelStatus(id, type)
  const phase = getCliChromePhase(type, status)
  const showChrome = !flush && phase !== 'off'
  const cliLogo = getCliLogo(type)
  const isMac = isMacOS()
  const isWin = isWindows()
  const isWebChatPanel = type === 'chatgpt' || type === 'claude-chat'
  const isTerminalPanel = PTY_PANEL_TYPES.includes(type)
  const showMacWindowControls = isMac && isTerminalPanel && Boolean(onClose) && !onHide
  const accountKind = getAccountKind(type)
  const accounts = useAiAccountsStore((state) => state.accounts)
  const activeAccountByKind = useAiAccountsStore((state) => state.activeAccountByKind)
  const renamePanel = useWorkspaceStore((state) => state.renamePanel)
  const account = accountKind
    ? accountId
      ? accounts.find((candidate) => candidate.id === accountId) ?? null
      : accounts.find((candidate) => candidate.id === activeAccountByKind[accountKind]) ?? null
    : null
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [accountInfoOpen, setAccountInfoOpen] = useState(false)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const showDragHandle = !isWebChatPanel && (draggable || Boolean(onHeaderPointerDown))

  useEffect(() => {
    setTitleDraft(title)
  }, [title])

  const beginRename = (): void => {
    if (!isTerminalPanel) return
    setTitleDraft(title)
    setEditingTitle(true)
    setAccountInfoOpen(false)
  }

  const cancelRename = (): void => {
    setTitleDraft(title)
    setEditingTitle(false)
  }

  const commitRename = (): void => {
    const normalizedTitle = titleDraft.trim()
    if (normalizedTitle) renamePanel(id, normalizedTitle)
    cancelRename()
  }

  return (
    <>
      <div
        className={cn(
          'panel-shell relative flex h-full flex-col overflow-hidden bg-panel-bg',
          flush ? 'panel-shell-flush rounded-none border-0' : 'rounded-md border border-border shadow-sm',
          isMac && 'panel-shell-macos',
          isWin && 'panel-shell-windows',
          showChrome && cliFrameClass(phase)
        )}
      >
        {showChrome && phase === 'busy' && <div className="cli-busy-wash" aria-hidden />}
        {showHeader && (
        <header
          className={cn(
            'group relative z-[3] flex shrink-0 items-center border-b app-no-drag',
            showMacWindowControls
              ? 'panel-titlebar-macos h-[38px] gap-2 px-3'
              : 'h-7 gap-1.5 border-border/80 bg-elevated/65 px-2 backdrop-blur-md',
            isMac && 'panel-header-macos',
            isWin && 'panel-header-windows',
            onHeaderPointerDown && 'cursor-grab active:cursor-grabbing',
            !windowActive && showMacWindowControls && 'panel-titlebar-macos-inactive'
          )}
          draggable={draggable && !onHeaderPointerDown}
          onPointerDown={onHeaderPointerDown}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {showMacWindowControls && onClose && (
            <MacTrafficLightControls title={title} onClose={onClose} inactive={!windowActive} />
          )}
          {showDragHandle && !showMacWindowControls && (
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          )}
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitRename}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') cancelRename()
              }}
              maxLength={120}
              className="min-w-0 flex-1 rounded border border-primary/40 bg-app-bg px-1.5 py-0.5 text-xs text-text-primary outline-none"
              aria-label="Rename terminal"
            />
          ) : (
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5',
                showMacWindowControls && 'justify-center'
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
                {cliLogo ? (
                  <img src={cliLogo} alt="" className="h-3.5 w-3.5 object-contain" />
                ) : (
                  getPanelTypeIcon(type)
                )}
              </span>
              <span
                className={cn(
                  'min-w-0 truncate font-medium text-text-primary',
                  showMacWindowControls ? 'text-[13px] tracking-tight' : 'flex-1 text-xs'
                )}
                title={isTerminalPanel ? 'Double-click or use the pencil to rename' : title}
                onDoubleClick={isTerminalPanel ? beginRename : undefined}
              >
                {title}
              </span>
              {isTerminalPanel && (
                <button
                  type="button"
                  onClick={beginRename}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-hover hover:text-text-primary group-hover:opacity-100"
                  aria-label={`Rename ${title}`}
                  title="Rename terminal"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {accountKind && (
              <button
                ref={accountButtonRef}
                type="button"
                onClick={() => setAccountInfoOpen((open) => !open)}
                onPointerDown={(event) => event.stopPropagation()}
                className={cn(
                  'shrink-0 rounded p-0.5 text-text-muted transition-colors hover:bg-primary/10 hover:text-primary',
                  accountInfoOpen && 'bg-primary/10 text-primary'
                )}
                aria-label={`Show ${title} account information`}
                aria-expanded={accountInfoOpen}
                title={account ? `Active account: ${account.name}` : 'Account information'}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            )}
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
            {!onHide && onClose && !showMacWindowControls && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-sm p-0.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                aria-label={`Close ${title}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </header>
        )}
        <div className={cn('min-h-0 flex-1 overflow-hidden', !showHeader && 'rounded-md')}>
          <PanelContent panelId={id} type={type} launchMode={launchMode} accountId={accountId} />
        </div>
      </div>
      {accountKind ? (
        <AccountInfoPopover
          open={accountInfoOpen}
          title={title}
          accountKind={accountKind}
          account={account}
          accountId={accountId}
          anchorRef={accountButtonRef}
          onClose={() => setAccountInfoOpen(false)}
        />
      ) : null}
    </>
  )
}

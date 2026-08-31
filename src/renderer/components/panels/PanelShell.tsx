import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { type PanelType } from '@shared/types'
import type { PtyLaunchMode, PtySessionStatus } from '@shared/contracts/pty'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS, type AiAccount } from '@shared/contracts/accounts'
import { cn, getPanelTypeIcon } from '@renderer/lib/utils'
import { cliFrameClass, getCliChromePhase } from '@renderer/lib/cli-chrome'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
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
  return `Last signed in ${new Date(timestamp).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  })}`
}

function MacTrafficLightControls({ title, onClose }: { title: string; onClose: () => void }): React.JSX.Element {
  return (
    <div
      className="mac-traffic-lights"
      aria-label={`${title} window controls`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="mac-traffic-light mac-traffic-light-close"
        onClick={onClose}
        aria-label={`Close ${title}`}
        title={`Close ${title}`}
      />
      <span className="mac-traffic-light mac-traffic-light-minimize" aria-hidden />
      <span className="mac-traffic-light mac-traffic-light-maximize" aria-hidden />
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
  accountId
}: PanelShellProps): React.JSX.Element {
  const status = usePanelStatus(id, type)
  const phase = getCliChromePhase(type, status)
  const showChrome = !flush && phase !== 'off'
  const cliLogo = getCliLogo(type)
  const isMac = isMacOS()
  const isWin = isWindows()
  const isWebChatPanel = type === 'chatgpt' || type === 'claude-chat'
  const showMacTerminalControls = isMac && type === 'terminal' && Boolean(onClose)
  const isTerminalPanel = PTY_PANEL_TYPES.includes(type)
  const accountKind = getAccountKind(type)
  const accounts = useAiAccountsStore((state) => state.accounts)
  const activeAccountByKind = useAiAccountsStore((state) => state.activeAccountByKind)
  const renamePanel = useWorkspaceStore((state) => state.renamePanel)
  const account = accountKind
    ? accounts.find((candidate) => candidate.id === accountId) ??
      accounts.find((candidate) => candidate.id === activeAccountByKind[accountKind]) ??
      null
    : null
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [accountInfoOpen, setAccountInfoOpen] = useState(false)
  const [accountPopoverPosition, setAccountPopoverPosition] = useState({ top: 0, left: 0 })
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const accountPopoverRef = useRef<HTMLDivElement>(null)
  const showDragHandle = !isWebChatPanel && (draggable || Boolean(onHeaderPointerDown))

  useEffect(() => {
    setTitleDraft(title)
  }, [title])

  useEffect(() => {
    if (!accountInfoOpen) return

    const updatePopoverPosition = (): void => {
      const button = accountButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const width = 288
      setAccountPopoverPosition({
        top: rect.bottom + 6,
        left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
      })
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (accountButtonRef.current?.contains(target) || accountPopoverRef.current?.contains(target)) {
        return
      }
      setAccountInfoOpen(false)
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAccountInfoOpen(false)
    }

    updatePopoverPosition()
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [accountInfoOpen])

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

  const accountPopover = accountInfoOpen && accountKind
    ? createPortal(
        <div
          ref={accountPopoverRef}
          role="dialog"
          aria-label={`${title} account information`}
          className="app-no-drag fixed z-[10000] w-72 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl"
          style={{ top: accountPopoverPosition.top, left: accountPopoverPosition.left }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-2.5 border-b border-border bg-panel-bg px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <UserRound className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-text-primary">
                {account?.name ?? (accountId ? 'Account unavailable' : 'No active account')}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                {AI_ACCOUNT_LABELS[accountKind]}
              </p>
            </div>
            <span className={cn(
              'rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
              account?.profileReady
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-warning/30 bg-warning/10 text-warning'
            )}>
              {account?.profileReady ? 'Ready' : 'Not ready'}
            </span>
          </div>
          {account ? (
            <div className="space-y-2 px-3 py-2.5 text-[11px]">
              <div className="flex items-start justify-between gap-3">
                <span className="text-text-muted">Email</span>
                <span className="max-w-[190px] break-all text-right text-text-secondary">
                  {account.email || 'Not provided'}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-text-muted">Plan</span>
                <span className="text-right text-text-secondary">{account.plan || 'Not provided'}</span>
              </div>
              <div className="border-t border-border pt-2 font-mono text-[10px] text-text-muted">
                {formatAccountDate(account.lastAuthenticatedAt)}
              </div>
              {account.note && (
                <p className="border-t border-border pt-2 text-[10px] leading-relaxed text-text-muted">
                  {account.note}
                </p>
              )}
            </div>
          ) : (
            <p className="px-3 py-3 text-[11px] leading-relaxed text-text-muted">
              This CLI terminal does not have an account profile selected. It will use the standard session configured on the computer.
            </p>
          )}
        </div>,
        document.body
      )
    : null

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
            'group relative z-[3] flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-elevated px-2 app-no-drag',
            isMac && 'panel-header-macos',
            isWin && 'panel-header-windows',
            onHeaderPointerDown && 'cursor-grab active:cursor-grabbing'
          )}
          draggable={draggable && !onHeaderPointerDown}
          onPointerDown={onHeaderPointerDown}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {showMacTerminalControls && onClose && (
            <MacTrafficLightControls title={title} onClose={onClose} />
          )}
          {showDragHandle && !showMacTerminalControls && (
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          )}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center font-mono text-xs text-text-muted">
            {cliLogo ? (
              <img src={cliLogo} alt="" className={CLI_LOGO_CLASS} />
            ) : (
              getPanelTypeIcon(type)
            )}
          </span>
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
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <span
                className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary"
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
          {!onHide && onClose && !showMacTerminalControls && (
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
      {accountPopover}
    </>
  )
}

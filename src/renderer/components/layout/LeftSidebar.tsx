import { PanelLeftClose, UsersRound } from 'lucide-react'
import { AiAccountsPanel } from '@renderer/components/accounts/AiAccountsPanel'
import { FileExplorerPanel } from '@renderer/components/file-explorer/FileExplorerPanel'
import { GitChangesPanel } from '@renderer/components/git/GitChangesPanel'
import { cn, getPanelTypeIcon } from '@renderer/lib/utils'

interface LeftSidebarProps {
  view: 'files' | 'changes' | 'accounts'
  onHide: () => void
}

export function LeftSidebar({ view, onHide }: LeftSidebarProps): React.JSX.Element {
  const isChanges = view === 'changes'
  const isAccounts = view === 'accounts'
  const title = isChanges ? 'Changes' : isAccounts ? 'AI Accounts' : 'Files'
  const type = isChanges ? 'git-changes' : 'file-explorer'

  return (
    <div className="panel-shell relative flex h-full flex-col overflow-hidden rounded-md border border-border bg-panel-bg shadow-sm">
      <header className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-elevated px-2 app-no-drag">
        <span className="font-mono text-xs text-text-muted">
          {isAccounts ? (
            <UsersRound className="h-3.5 w-3.5" />
          ) : (
            getPanelTypeIcon(type)
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
          {title}
        </span>
        <button
          type="button"
          onClick={onHide}
          className="rounded-sm p-0.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cn('h-full', (isChanges || isAccounts) && 'hidden')}>
          <FileExplorerPanel />
        </div>
        <div className={cn('h-full', !isChanges && 'hidden')}>
          <GitChangesPanel hideHeader />
        </div>
        {isAccounts && <div className="h-full"><AiAccountsPanel /></div>}
      </div>
    </div>
  )
}

import { BarChart3, Music2, PanelLeftClose, UsersRound } from 'lucide-react'
import { AiAccountsPanel } from '@renderer/components/accounts/AiAccountsPanel'
import { FileExplorerPanel } from '@renderer/components/file-explorer/FileExplorerPanel'
import { GitChangesPanel } from '@renderer/components/git/GitChangesPanel'
import { TasksPanel } from '@renderer/components/tasks/TasksPanel'
import { ProfilePanel } from '@renderer/components/profile/ProfilePanel'
import { MusicPanel } from '@renderer/components/music/MusicPanel'
import { cn } from '@renderer/lib/utils'
import { PanelIcon } from '@renderer/components/ui/PanelIcon'
import { Button } from '@renderer/components/ui/Button'

interface LeftSidebarProps {
  view: 'files' | 'changes' | 'accounts' | 'tasks' | 'profile' | 'music'
  onHide: () => void
}

export function LeftSidebar({ view, onHide }: LeftSidebarProps): React.JSX.Element {
  const isChanges = view === 'changes'
  const isAccounts = view === 'accounts'
  const isTasks = view === 'tasks'
  const isProfile = view === 'profile'
  const isMusic = view === 'music'
  const title = isChanges
    ? 'Changes'
    : isAccounts
      ? 'AI Accounts'
      : isTasks
        ? 'Tasks'
        : isProfile
          ? 'Profile'
          : isMusic
            ? 'Music'
            : 'Files'
  const type = isChanges ? 'git-changes' : isTasks ? 'tasks' : 'file-explorer'

  return (
    <div className="workstation-sidebar panel-shell relative flex h-full flex-col overflow-hidden">
      <header className="panel-header sidebar-header flex shrink-0 items-center gap-2 border-b px-3 app-no-drag">
        <span className="font-mono text-xs text-text-muted">
          {isAccounts ? (
            <UsersRound className="h-3.5 w-3.5" />
          ) : isProfile ? (
            <BarChart3 className="h-3.5 w-3.5" />
          ) : isMusic ? (
            <Music2 className="h-3.5 w-3.5" />
          ) : (
            <PanelIcon type={type} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
          {title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onHide}
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cn('h-full', (isChanges || isAccounts || isTasks || isProfile || isMusic) && 'hidden')}>
          <FileExplorerPanel />
        </div>
        <div className={cn('h-full', !isChanges && 'hidden')}>
          <GitChangesPanel hideHeader />
        </div>
        <div className={cn('h-full', !isAccounts && 'hidden')}>
          <AiAccountsPanel />
        </div>
        <div className={cn('h-full', !isTasks && 'hidden')}>
          <TasksPanel />
        </div>
        <div className={cn('h-full', !isProfile && 'hidden')}>
          <ProfilePanel visible={isProfile} />
        </div>
        <div className={cn('h-full', !isMusic && 'hidden')}>
          <MusicPanel />
        </div>
      </div>
    </div>
  )
}

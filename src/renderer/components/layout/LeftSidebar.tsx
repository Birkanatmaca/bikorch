import { PanelLeftClose } from 'lucide-react'
import { AiAccountsPanel } from '@renderer/components/accounts/AiAccountsPanel'
import { FileExplorerPanel } from '@renderer/components/file-explorer/FileExplorerPanel'
import { GitChangesPanel } from '@renderer/components/git/GitChangesPanel'
import { TasksPanel } from '@renderer/components/tasks/TasksPanel'
import { ProfilePanel } from '@renderer/components/profile/ProfilePanel'
import { MusicPanel } from '@renderer/components/music/MusicPanel'
import { cn } from '@renderer/lib/utils'
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
      ? 'CLI accounts'
      : isTasks
        ? 'Tasks'
        : isProfile
          ? 'Profile'
          : isMusic
            ? 'Music'
            : 'Files'
  return (
    <div className="workstation-sidebar panel-shell relative flex h-full flex-col overflow-hidden">
      <header className="sidebar-header app-no-drag">
        <span className="sidebar-header-title">{title}</span>
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

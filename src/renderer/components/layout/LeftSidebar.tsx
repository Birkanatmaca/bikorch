import { PanelLeftClose } from 'lucide-react'
import { AiAccountsPanel } from '@renderer/components/accounts/AiAccountsPanel'
import { AgentSetupPanel } from '@renderer/components/setup/AgentSetupPanel'
import { ApiKeysPanel } from '@renderer/components/setup/ApiKeysPanel'
import { FileExplorerPanel } from '@renderer/components/file-explorer/FileExplorerPanel'
import { GitChangesPanel } from '@renderer/components/git/GitChangesPanel'
import { TasksPanel } from '@renderer/components/tasks/TasksPanel'
import { MemoryManager } from '@renderer/components/profile/MemoryManager'
import { ProfilePanel } from '@renderer/components/profile/ProfilePanel'
import { StoragePanel } from '@renderer/components/storage/StoragePanel'
import { MusicPanel } from '@renderer/components/music/MusicPanel'
import { TimerPanel } from '@renderer/components/timer/TimerPanel'
import { SidebarTimerDock } from '@renderer/components/timer/SidebarTimerDock'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/Button'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import type { LeftSidebarView } from '@shared/types'

interface LeftSidebarProps {
  view: LeftSidebarView
  onHide: () => void
}

const TITLES: Record<LeftSidebarView, string> = {
  files: 'Files',
  changes: 'Agent Work & Changes',
  accounts: 'CLI accounts',
  clis: 'CLI setup',
  apiKeys: 'API keys',
  memory: 'Intelligence',
  tasks: 'Tasks',
  profile: 'Developer Profile',
  storage: 'Storage & caches',
  music: 'Music',
  timer: 'Timer'
}

export function LeftSidebar({ view, onHide }: LeftSidebarProps): React.JSX.Element {
  const title = TITLES[view] ?? 'Files'
  const { projectId } = useActiveProject()
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
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
        <div className={cn('h-full', view !== 'files' && 'hidden')}>
          <FileExplorerPanel />
        </div>
        <div className={cn('h-full', view !== 'changes' && 'hidden')}>
          <GitChangesPanel hideHeader />
        </div>
        <div className={cn('h-full', view !== 'accounts' && 'hidden')}>
          <AiAccountsPanel />
        </div>
        <div className={cn('h-full overflow-x-hidden overflow-y-auto p-2.5', view !== 'clis' && 'hidden')}>
          {view === 'clis' && <AgentSetupPanel compact embedded />}
        </div>
        <div className={cn('h-full overflow-x-hidden overflow-y-auto p-2.5', view !== 'apiKeys' && 'hidden')}>
          {view === 'apiKeys' && <ApiKeysPanel compact embedded />}
        </div>
        <div className={cn('h-full overflow-x-hidden overflow-y-auto p-2.5', view !== 'memory' && 'hidden')}>
          <MemoryManager
            active={view === 'memory'}
            onOpenProfile={() => { if (projectId) selectLeftSidebar(projectId, 'profile') }}
          />
        </div>
        <div className={cn('h-full', view !== 'tasks' && 'hidden')}>
          <TasksPanel />
        </div>
        <div className={cn('h-full', view !== 'profile' && 'hidden')}>
          <ProfilePanel visible={view === 'profile'} />
        </div>
        <div className={cn('h-full overflow-x-hidden overflow-y-auto', view !== 'storage' && 'hidden')}>
          {view === 'storage' && <StoragePanel />}
        </div>
        <div className={cn('h-full', view !== 'music' && 'hidden')}>
          <MusicPanel />
        </div>
        <div className={cn('h-full', view !== 'timer' && 'hidden')}>
          <TimerPanel />
        </div>
      </div>
      {view !== 'timer' ? <SidebarTimerDock /> : null}
    </div>
  )
}

import { ProjectTabs } from '../workspace/ProjectTabs'
import { AddPanelMenu } from '../workspace/AddPanelMenu'
import { ChatMenu } from './ChatMenu'
import { AppLogo } from '../brand/AppLogo'
import { MenuBar } from './MenuBar'
import { TitleBarControls } from './TitleBarControls'
import { cn } from '@renderer/lib/utils'
import { isMacOS, isWindows } from '@renderer/lib/electron-api'

interface AppHeaderProps {
  showWorkspaceControls?: boolean
  onCommandPalette?: () => void
}

export function AppHeader({
  showWorkspaceControls = true,
  onCommandPalette
}: AppHeaderProps): React.JSX.Element {
  const isWin = isWindows()
  const isMac = isMacOS()

  return (
    <header
      className={cn(
        'app-header glass-surface flex h-9 shrink-0 items-center border-b',
        (isWin || isMac) && 'app-drag-region',
        isMac && 'app-header-macos',
        isWin && 'app-header-windows',
        isWin ? 'pl-0 pr-0' : 'px-2'
      )}
      onDoubleClick={(event) => {
        if (!isWin || !window.api?.window) return
        if ((event.target as HTMLElement).closest('.app-no-drag')) return
        void window.api.window.maximize()
      }}
    >
      <div
        className={cn(
          'flex shrink-0 items-center app-no-drag',
          isMac ? 'pl-[76px]' : 'pl-2.5'
        )}
      >
        <AppLogo size="xs" className="opacity-90" />
        <div className="mx-1.5 h-4 w-px bg-border" />
        <MenuBar onCommandPalette={onCommandPalette} />
      </div>

      {showWorkspaceControls && (
        <>
          <div className="mx-2 h-4 w-px shrink-0 bg-border" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <ProjectTabs />
          </div>
        </>
      )}

      {!showWorkspaceControls && <div className="min-h-full min-w-8 flex-1" aria-hidden />}

      <div className={cn('app-header-actions flex shrink-0 items-center gap-1.5 app-no-drag', isWin ? 'pr-0' : 'pr-1')}>
        {showWorkspaceControls && <AddPanelMenu />}
        {showWorkspaceControls && <ChatMenu />}
        <TitleBarControls />
      </div>
    </header>
  )
}

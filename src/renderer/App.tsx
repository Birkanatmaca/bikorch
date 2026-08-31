import { useEffect } from 'react'
import { AppHeader } from '@renderer/components/layout/AppHeader'
import { StatusBar } from '@renderer/components/layout/StatusBar'
import { WorkspaceLayout } from '@renderer/components/layout/WorkspaceLayout'
import { WelcomeScreen } from '@renderer/components/welcome/WelcomeScreen'
import { CommandPalette } from '@renderer/components/command/CommandPalette'
import { ErrorBoundary } from '@renderer/components/ui/ErrorBoundary'
import { LoadingSplash } from '@renderer/components/ui/LoadingSplash'
import { COMMAND_PALETTE_EVENT, isTypingInTerminal } from '@renderer/lib/app-events'
import { useCommandPalette } from '@renderer/hooks/use-command-palette'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { usePersistenceBootstrap } from '@renderer/hooks/use-persistence-bootstrap'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { isMacOS, isWindows } from '@renderer/lib/electron-api'

export default function App(): React.JSX.Element {
  const { isReady, error } = usePersistenceBootstrap()
  const { open, openPalette, closePalette } = useCommandPalette()
  const { openFolderPicker } = useOpenProject()
  const projects = useWorkspaceStore((s) => s.projects)
  const addProject = useWorkspaceStore((s) => s.addProject)
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const platformClass = isMacOS()
    ? 'platform-macos'
    : isWindows()
      ? 'platform-windows'
      : 'platform-linux'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isTypingInTerminal(e.target)) return

      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return

      if (e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void openFolderPicker()
      }

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        addProject()
      }

      if (e.key === '`') {
        e.preventDefault()
        if (useWorkspaceStore.getState().activeProjectId) {
          addPanel('terminal', 'center')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addPanel, addProject, openFolderPicker])

  useEffect(() => {
    const handleOpenPalette = (): void => {
      openPalette()
    }

    window.addEventListener(COMMAND_PALETTE_EVENT, handleOpenPalette)
    return () => window.removeEventListener(COMMAND_PALETTE_EVENT, handleOpenPalette)
  }, [openPalette])

  if (!isReady) {
    return <LoadingSplash />
  }

  return (
    <ErrorBoundary>
      <div className={cn('flex h-full flex-col bg-app-bg', platformClass)}>
        {error && (
          <div className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            {error} — using fallback workspace
          </div>
        )}
        <AppHeader showWorkspaceControls={projects.length > 0} onCommandPalette={openPalette} />
        {projects.length > 0 ? <WorkspaceLayout /> : <WelcomeScreen />}
        <StatusBar />
        <CommandPalette open={open} onClose={closePalette} />
      </div>
    </ErrorBoundary>
  )
}

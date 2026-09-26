// Isolated UI fixture: no real folders, accounts, CLIs or application data.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WelcomeScreen } from '../../src/renderer/components/welcome/WelcomeScreen'
import { WorkspaceCenterEmpty } from '../../src/renderer/components/workspace/WorkspaceCenterEmpty'
import { FileExplorerPanel } from '../../src/renderer/components/file-explorer/FileExplorerPanel'
import { AppHeader } from '../../src/renderer/components/layout/AppHeader'
import { SidebarActivityBar } from '../../src/renderer/components/layout/SidebarActivityBar'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace-store'
import { buildPersistedSnapshot, startPersistenceSync } from '../../src/renderer/lib/persistence-sync'
import { usePersistenceBootstrap } from '../../src/renderer/hooks/use-persistence-bootstrap'
import '../../src/renderer/styles/globals.css'
import '../../src/renderer/styles/workstation.css'
import '../../src/renderer/styles/studio.css'

let persistedProjects: Array<{ id: string; folderPath: string }> = []
let failReads = false
let nextFolder: string | null = '/projects/aurora-studio'
const reads: Record<string, number> = {}
const fixtureErrors: string[] = []
const bootstrapMode = new URLSearchParams(location.search).has('bootstrap')
let emptySaves = 0
let snapshotOnDisk = {
  ...buildPersistedSnapshot(),
  projects: [{ id: 'restored', name: 'Restored project', folderPath: '/projects/restored' }],
  activeProjectId: 'restored'
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
Object.assign(window, {
  api: {
    platform: 'win32',
    selectFolder: async () => { await delay(100); return nextFolder },
    window: {
      isMaximized: async () => false,
      minimize: async () => undefined,
      maximize: async () => false,
      close: async () => undefined
    },
    persistence: {
      load: async () => { await delay(150); return structuredClone(snapshotOnDisk) },
      onFlushRequest: () => () => {},
      finishFlush: () => {},
      save: async (snapshot: { projects: typeof persistedProjects }) => {
        if (snapshot.projects.length === 0) emptySaves += 1
        // Deliberately outlast the old 400ms debounce to reproduce startup races.
        await delay(650)
        persistedProjects = snapshot.projects
        snapshotOnDisk = snapshot as typeof snapshotOnDisk
      }
    },
    authProfiles: { list: async () => null },
    git: { discover: async () => ({ repos: [] }) },
    fs: {
      readDirectory: async ({ projectId, directoryPath }: { projectId: string; directoryPath: string }) => {
        reads[directoryPath] = (reads[directoryPath] ?? 0) + 1
        const project = persistedProjects.find((item) => item.id === projectId)
        if (!project) {
          fixtureErrors.push('read before registration')
          throw new Error("Error invoking remote method 'fs:readDirectory': Error: The requested project is not available")
        }
        await delay(directoryPath.includes('slow-project') ? 700 : 30)
        if (failReads) throw new Error("Error invoking remote method 'fs:readDirectory': Error: ENOENT: folder moved")
        return { entries: directoryPath.endsWith('/empty') ? [] : [
          { name: 'empty', path: directoryPath + '/empty', type: 'directory' },
          { name: directoryPath.includes('slow-project') ? 'old-project.txt' : 'README.md', path: directoryPath + '/README.md', type: 'file' }
        ] }
      },
      search: async () => {
        if (failReads) throw new Error('EACCES: permission denied')
        return { entries: [] }
      }
    }
  },
  studioFixture: {
    reads, errors: fixtureErrors,
    emptySaves: () => emptySaves,
    setFailure: (value: boolean) => { failReads = value },
    setFolder: (value: string | null) => { nextFolder = value },
    showHome: () => useWorkspaceStore.getState().showHome(),
    switchProject: (name: string) => useWorkspaceStore.getState().addProject(name, '/projects/' + name)
  }
})
if (!bootstrapMode) startPersistenceSync()

function BootstrapCheck() {
  const { isReady, error } = usePersistenceBootstrap()
  return isReady ? <div data-bootstrap-ready data-bootstrap-error={error ?? ''}><Fixture /></div> : <p>Restoring…</p>
}

function Fixture() {
  const projects = useWorkspaceStore((state) => state.projects)
  const home = useWorkspaceStore((state) => state.homeVisible)
  const [sidebar, setSidebar] = useState(false)
  return <div className="app-shell platform-windows flex h-full flex-col">
    <AppHeader showWorkspaceControls={projects.length > 0} />
    {!projects.length || home ? <WelcomeScreen /> : (
      <div className="workspace-frame flex min-h-0 flex-1">
        <SidebarActivityBar isOpen={sidebar} view="files" changesCount={0} onSelectFiles={() => setSidebar(!sidebar)} onSelectChanges={() => {}} onSelectAccounts={() => {}} onSelectTasks={() => {}} onSelectProfile={() => {}} onSelectAutomation={() => {}} onSelectMusic={() => {}} onSelectTimer={() => {}} />
        <div className="workspace-main relative flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspaceCenterEmpty />
          {sidebar && <div className="workspace-sidebar-overlay" style={{ width: 280 }}><div className="workstation-sidebar panel-shell flex h-full flex-col"><header className="sidebar-header"><span className="sidebar-header-title">Files</span><button type="button" aria-label="Hide sidebar" onClick={() => setSidebar(false)}>Close</button></header><FileExplorerPanel /></div></div>}
        </div>
      </div>
    )}
  </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode>{bootstrapMode ? <BootstrapCheck /> : <Fixture />}</StrictMode>)

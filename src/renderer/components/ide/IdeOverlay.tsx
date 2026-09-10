import { useEffect, useMemo, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import {
  ArrowLeft,
  FileCode2,
  RotateCcw,
  Save,
  Undo2,
  X
} from 'lucide-react'
import { PANEL_TYPE_LABELS, type PanelDefinition, type PanelType } from '@shared/types'
import { FileExplorerPanel } from '@renderer/components/file-explorer/FileExplorerPanel'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { buttonStyles } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { getCliLogo } from '@renderer/lib/cli-logos'
import { focusWorkspacePanel } from '@renderer/lib/app-events'
import { cn } from '@renderer/lib/utils'
import '@renderer/lib/monaco'
import { tabIsDirty, useIdeStore } from '@renderer/stores/ide-store'
import { resolveFileChange, useGitStore } from '@renderer/stores/git-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const PTY_TYPES: PanelType[] = ['terminal', 'claude', 'cursor', 'gemini', 'antigravity', 'codex']

const STATUS_LABEL: Record<string, string> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  busy: 'Working',
  stopped: 'Stopped',
  error: 'Error'
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export function IdeOverlay(): React.JSX.Element | null {
  const open = useIdeStore((state) => state.open)
  const tabs = useIdeStore((state) => state.tabs)
  const activePath = useIdeStore((state) => state.activePath)
  const saving = useIdeStore((state) => state.saving)
  const setActive = useIdeStore((state) => state.setActive)
  const setValue = useIdeStore((state) => state.setValue)
  const save = useIdeStore((state) => state.save)
  const revert = useIdeStore((state) => state.revert)
  const discardGit = useIdeStore((state) => state.discardGit)
  const closeTab = useIdeStore((state) => state.closeTab)
  const closeTabForced = useIdeStore((state) => state.closeTabForced)
  const closeIde = useIdeStore((state) => state.closeIde)
  const forceClose = useIdeStore((state) => state.forceClose)

  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const workspace = useWorkspaceStore((state) =>
    activeProjectId ? state.workspaces[activeProjectId] : null
  )
  const sessions = useTerminalStore((state) => state.sessions)
  const gitStateByProject = useGitStore((state) => state.stateByProject)

  const [confirm, setConfirm] = useState<'close-ide' | 'close-tab' | 'revert' | 'git' | null>(null)
  const [pendingTab, setPendingTab] = useState<string | null>(null)
  const [pendingCli, setPendingCli] = useState<string | null>(null)

  const activeTab = tabs.find((tab) => tab.absolutePath === activePath) ?? tabs[0] ?? null
  const dirty = activeTab ? tabIsDirty(activeTab) : false
  const gitChange = activeTab
    ? resolveFileChange(gitStateByProject, activeTab.projectId, activeTab.absolutePath)
    : null

  const cliPanels = useMemo(() => {
    const panels = workspace?.panels ?? []
    return panels.filter((panel): panel is PanelDefinition => PTY_TYPES.includes(panel.type))
  }, [workspace?.panels])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent): void => {
      const isMod = event.metaKey || event.ctrlKey
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (useIdeStore.getState().closeIde()) return
        setConfirm('close-ide')
        return
      }
      if (isMod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        void useIdeStore.getState().save()
      }
      if (isMod && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        event.stopPropagation()
        const path = useIdeStore.getState().activePath
        if (!path) return
        if (useIdeStore.getState().closeTab(path)) return
        setPendingTab(path)
        setConfirm('close-tab')
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  const requestCloseIde = (): void => {
    if (closeIde()) return
    setConfirm('close-ide')
  }

  const requestCloseTab = (path: string): void => {
    if (closeTab(path)) return
    setPendingTab(path)
    setConfirm('close-tab')
  }

  const requestRevert = (): void => {
    if (!activeTab) return
    if (dirty) {
      setConfirm('revert')
      return
    }
    if (gitChange) {
      setConfirm('git')
    }
  }

  const jumpToCli = (panelId: string): void => {
    if (tabs.some(tabIsDirty)) {
      setPendingCli(panelId)
      setConfirm('close-ide')
      return
    }
    forceClose()
    focusWorkspacePanel(panelId)
  }

  const confirmAction = (): void => {
    if (confirm === 'close-ide') {
      const panelId = pendingCli
      forceClose()
      if (panelId) focusWorkspacePanel(panelId)
    } else if (confirm === 'close-tab' && pendingTab) {
      closeTabForced(pendingTab)
    } else if (confirm === 'revert') {
      revert()
    } else if (confirm === 'git') {
      void discardGit()
    }
    setConfirm(null)
    setPendingTab(null)
    setPendingCli(null)
  }

  if (!open) return null

  const confirmCopy =
    confirm === 'git'
      ? 'Discard git changes for this file?'
      : confirm === 'revert'
        ? 'Discard unsaved edits in this file?'
        : 'Unsaved edits will be lost.'

  return (
    <div className="ide-overlay" role="dialog" aria-label="Editor">
      <header className="ide-chrome">
        <button
          type="button"
          className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          onClick={requestCloseIde}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          CLI
        </button>

        <div className="ide-tabs">
          {tabs.map((tab) => {
            const isActive = tab.absolutePath === activeTab?.absolutePath
            return (
              <div
                key={tab.absolutePath}
                className={cn('ide-tab', isActive && 'is-active')}
              >
                <button
                  type="button"
                  className="ide-tab-label"
                  onClick={() => setActive(tab.absolutePath)}
                  title={tab.relativePath}
                >
                  <span className="truncate">{fileName(tab.relativePath)}</span>
                  {tabIsDirty(tab) && <span className="ide-tab-dot" aria-label="Unsaved" />}
                </button>
                <button
                  type="button"
                  className="ide-tab-close"
                  onClick={() => requestCloseTab(tab.absolutePath)}
                  aria-label={`Close ${fileName(tab.relativePath)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="ide-cli-rail" aria-label="Open CLIs">
          {cliPanels.length === 0 ? (
            <span className="ide-cli-empty">No CLIs</span>
          ) : (
            cliPanels.map((panel) => {
              const logo = getCliLogo(panel.type)
              const status = sessions[panel.id] ?? 'running'
              return (
                <button
                  key={panel.id}
                  type="button"
                  className={cn('ide-cli-chip', `is-${status}`)}
                  title={`${panel.title} · ${STATUS_LABEL[status] ?? status}`}
                  onClick={() => jumpToCli(panel.id)}
                >
                  {logo ? (
                    <img src={logo} alt="" className="ide-cli-logo" />
                  ) : (
                    <span className="ide-cli-fallback">{PANEL_TYPE_LABELS[panel.type].slice(0, 1)}</span>
                  )}
                  <span className="ide-cli-name">{panel.title}</span>
                  <span className="ide-cli-status">{STATUS_LABEL[status] ?? status}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="ide-actions">
          {gitChange && !dirty && (
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              onClick={() => setConfirm('git')}
              title="Discard git changes"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Discard
            </button>
          )}
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
            disabled={!dirty}
            onClick={requestRevert}
            title="Revert unsaved edits"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Revert
          </button>
          <button
            type="button"
            className={buttonStyles({ variant: 'primary', size: 'sm' })}
            disabled={!dirty || saving || activeTab?.binary}
            onClick={() => void save()}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
            onClick={requestCloseIde}
            aria-label="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="ide-body">
        <aside className="ide-files">
          <FileExplorerPanel />
        </aside>
        <section className="ide-editor">
          {!activeTab ? (
            <EmptyState icon={FileCode2} title="Editor" description="Double-click a file to open it" />
          ) : activeTab.loading ? (
            <div className="ide-message">Loading…</div>
          ) : activeTab.binary || (activeTab.error && !activeTab.value) ? (
            <EmptyState
              icon={FileCode2}
              title={activeTab.binary ? 'Binary file' : 'Could not open'}
              description={activeTab.error ?? activeTab.relativePath}
            />
          ) : (
            <>
              <div className="ide-path">
                <span>{activeTab.relativePath}</span>
                {dirty && <em>unsaved</em>}
                {gitChange && <em>{gitChange.change.status}</em>}
              </div>
              {activeTab.error && <div className="ide-error">{activeTab.error}</div>}
              <div className="ide-monaco">
                <Editor
                  key={activeTab.absolutePath}
                  height="100%"
                  width="100%"
                  value={activeTab.value}
                  language={activeTab.language}
                  theme="vs-dark"
                  onChange={(value) => setValue(activeTab.absolutePath, value ?? '')}
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    automaticLayout: true,
                    padding: { top: 12, bottom: 16 },
                    renderLineHighlight: 'line',
                    smoothScrolling: true,
                    tabSize: 2
                  }}
                  loading={<div className="ide-message">Loading editor…</div>}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm === 'git' ? 'Discard git changes' : 'Discard edits'}
          message={confirmCopy}
          confirmLabel="Discard"
          onConfirm={confirmAction}
          onCancel={() => {
            setConfirm(null)
            setPendingTab(null)
            setPendingCli(null)
          }}
        />
      )}
    </div>
  )
}

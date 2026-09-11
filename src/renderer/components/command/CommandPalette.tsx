import { useEffect, useMemo, useRef, useState } from 'react'
import { PANEL_TYPE_LABELS, type PanelType } from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useGitStore } from '@renderer/stores/git-store'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { Search } from 'lucide-react'

interface CommandItem {
  id: string
  label: string
  group: string
  keywords?: string
  action: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const selectLeftSidebar = useWorkspaceStore((s) => s.selectLeftSidebar)
  const setCanvasMode = useWorkspaceStore((s) => s.setCanvasMode)
  const { openFolderPicker } = useOpenProject()
  const { projectId, projectRoot } = useActiveProject()
  const refreshGit = useGitStore((s) => s.refresh)

  const commands: CommandItem[] = useMemo(() => {
    const panelCommands: CommandItem[] = (
      Object.entries(PANEL_TYPE_LABELS) as [PanelType, string][]
    ).filter(([type]) => type !== 'tasks').map(([type, label]) => ({
      id: `panel-${type}`,
      label,
      group: 'Panels',
      keywords: `add ${type} ${label}`,
      action: () => {
        addPanel(type)
        onClose()
      }
    }))

    return [
      {
        id: 'new-project',
        label: 'New Project',
        group: 'Workspace',
        action: () => {
          void openFolderPicker({ forceNew: true })
          onClose()
        }
      },
      {
        id: 'add-terminal',
        label: 'Terminal',
        group: 'Quick',
        keywords: 'add terminal',
        action: () => {
          addPanel('terminal')
          onClose()
        }
      },
      {
        id: 'add-claude',
        label: 'Claude',
        group: 'Quick',
        keywords: 'add claude code',
        action: () => {
          addPanel('claude')
          onClose()
        }
      },
      {
        id: 'add-cursor',
        label: 'Cursor',
        group: 'Quick',
        keywords: 'add cursor cli',
        action: () => {
          addPanel('cursor')
          onClose()
        }
      },
      {
        id: 'open-gemini',
        label: 'Gemini',
        group: 'Quick',
        keywords: 'open gemini cli',
        action: () => {
          addPanel('gemini')
          onClose()
        }
      },
      {
        id: 'open-antigravity',
        label: 'Antigravity',
        group: 'Quick',
        keywords: 'open antigravity cli',
        action: () => {
          addPanel('antigravity')
          onClose()
        }
      },
      {
        id: 'open-codex',
        label: 'Codex',
        group: 'Quick',
        keywords: 'open codex cli',
        action: () => {
          addPanel('codex')
          onClose()
        }
      },
      {
        id: 'show-changes',
        label: 'Show Changes',
        group: 'Git',
        keywords: 'diff source control review',
        action: () => {
          if (projectId) selectLeftSidebar(projectId, 'changes')
          onClose()
        }
      },
      {
        id: 'add-player',
        label: 'Player',
        group: 'Quick',
        keywords: 'add player music visualizer workspace',
        action: () => {
          addPanel('player')
          onClose()
        }
      },
      {
        id: 'add-timer',
        label: 'Timer',
        group: 'Quick',
        keywords: 'add timer pomodoro focus widget workspace',
        action: () => {
          addPanel('timer')
          onClose()
        }
      },
      {
        id: 'add-browser',
        label: 'Browser',
        group: 'Quick',
        keywords: 'add browser preview localhost inspect responsive search',
        action: () => {
          addPanel('browser')
          onClose()
        }
      },
      {
        id: 'show-music',
        label: 'Show Music',
        group: 'Workspace',
        keywords: 'music library player sidebar downloads',
        action: () => {
          if (projectId) selectLeftSidebar(projectId, 'music')
          onClose()
        }
      },
      {
        id: 'show-timer',
        label: 'Show Timer',
        group: 'Workspace',
        keywords: 'timer pomodoro focus stopwatch sidebar statistics',
        action: () => {
          if (projectId) selectLeftSidebar(projectId, 'timer')
          onClose()
        }
      },
      {
        id: 'show-tasks',
        label: 'Show Tasks',
        group: 'Workspace',
        keywords: 'task planning checklist sidebar',
        action: () => {
          if (projectId) selectLeftSidebar(projectId, 'tasks')
          onClose()
        }
      },
      {
        id: 'show-profile',
        label: 'Show Profile',
        group: 'Workspace',
        keywords: 'developer intelligence insights account statistics',
        action: () => {
          if (projectId) selectLeftSidebar(projectId, 'profile')
          onClose()
        }
      },
      {
        id: 'layout-free',
        label: 'Layout: Free',
        group: 'Layout',
        keywords: 'floating windows free canvas',
        action: () => {
          setCanvasMode('free')
          onClose()
        }
      },
      {
        id: 'layout-tiled',
        label: 'Layout: Tiled',
        group: 'Layout',
        keywords: 'tile auto equal cells',
        action: () => {
          setCanvasMode('tiled')
          onClose()
        }
      },
      {
        id: 'layout-grid-2x2',
        label: 'Layout: 2×2',
        group: 'Layout',
        keywords: 'quad split four grid',
        action: () => {
          setCanvasMode('grid-2x2')
          onClose()
        }
      },
      {
        id: 'layout-cols-4',
        label: 'Layout: 4 Columns',
        group: 'Layout',
        keywords: 'split vertical four columns side by side',
        action: () => {
          setCanvasMode('cols-4')
          onClose()
        }
      },
      {
        id: 'layout-rows-4',
        label: 'Layout: 4 Rows',
        group: 'Layout',
        keywords: 'split horizontal four rows stacked',
        action: () => {
          setCanvasMode('rows-4')
          onClose()
        }
      },
      {
        id: 'layout-cols-2',
        label: 'Layout: 2 Columns',
        group: 'Layout',
        keywords: 'split two columns',
        action: () => {
          setCanvasMode('cols-2')
          onClose()
        }
      },
      {
        id: 'layout-rows-2',
        label: 'Layout: 2 Rows',
        group: 'Layout',
        keywords: 'split two rows stacked',
        action: () => {
          setCanvasMode('rows-2')
          onClose()
        }
      },
      {
        id: 'refresh-git',
        label: 'Refresh Git Changes',
        group: 'Git',
        action: () => {
          if (projectId && projectRoot) {
            void refreshGit(projectId, projectRoot)
          }
          onClose()
        }
      },
      ...panelCommands
    ]
  }, [addPanel, onClose, openFolderPicker, projectId, projectRoot, refreshGit, selectLeftSidebar, setCanvasMode])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.group.toLowerCase().includes(q) ||
        cmd.keywords?.toLowerCase().includes(q)
    )
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }

      if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault()
        filtered[selectedIndex].action()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filtered, selectedIndex, onClose])

  if (!open) return null

  let lastGroup = ''

  return (
    <div className="command-overlay fixed inset-0 z-[110] flex items-start justify-center bg-black/50 px-4 pt-[15vh] backdrop-blur-sm animate-fade-in">
      <div className="command-surface w-full max-w-md overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl animate-slide-up" role="dialog" aria-label="Command palette" aria-modal="true">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            aria-label="Search commands"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="h-11 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="command-shortcut">Esc</kbd>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-text-muted">No commands found</p>
          )}
          {filtered.map((cmd, index) => {
            const showGroup = cmd.group !== lastGroup
            lastGroup = cmd.group
            return (
              <div key={cmd.id}>
                {showGroup && (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                    {cmd.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={cmd.action}
                  className={cn(
                    'flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors',
                    index === selectedIndex
                      ? 'bg-primary/15 text-text-primary'
                      : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                  )}
                >
                  {cmd.label}
                </button>
              </div>
            )
          })}
        </div>
        <div className="command-footer flex items-center gap-3 border-t px-3 py-2 text-[10px] text-text-muted">
          <span><kbd>↑ ↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Run command</span>
        </div>
      </div>
      <button
        type="button"
        className="fixed inset-0 -z-10"
        onClick={onClose}
        aria-label="Close command palette"
      />
    </div>
  )
}

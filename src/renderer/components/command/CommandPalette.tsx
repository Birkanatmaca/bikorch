import { useEffect, useMemo, useRef, useState } from 'react'
import { PANEL_TYPE_LABELS, type PanelType } from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useGitStore } from '@renderer/stores/git-store'
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
  const addProject = useWorkspaceStore((s) => s.addProject)
  const selectLeftSidebar = useWorkspaceStore((s) => s.selectLeftSidebar)
  const { projectId, projectRoot } = useActiveProject()
  const refreshGit = useGitStore((s) => s.refresh)

  const commands: CommandItem[] = useMemo(() => {
    const panelCommands: CommandItem[] = (
      Object.entries(PANEL_TYPE_LABELS) as [PanelType, string][]
    ).map(([type, label]) => ({
      id: `panel-${type}`,
      label: `Add ${label}`,
      group: 'Panels',
      keywords: type,
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
          addProject()
          onClose()
        }
      },
      {
        id: 'add-terminal',
        label: 'Add Terminal',
        group: 'Quick',
        action: () => {
          addPanel('terminal')
          onClose()
        }
      },
      {
        id: 'add-claude',
        label: 'Add Claude Code',
        group: 'Quick',
        action: () => {
          addPanel('claude')
          onClose()
        }
      },
      {
        id: 'add-cursor',
        label: 'Add Cursor CLI',
        group: 'Quick',
        action: () => {
          addPanel('cursor')
          onClose()
        }
      },
      {
        id: 'open-gemini',
        label: 'Open Gemini CLI',
        group: 'Quick',
        action: () => {
          addPanel('gemini')
          onClose()
        }
      },
      {
        id: 'open-antigravity',
        label: 'Open Antigravity CLI',
        group: 'Quick',
        action: () => {
          addPanel('antigravity')
          onClose()
        }
      },
      {
        id: 'open-codex',
        label: 'Open Codex CLI',
        group: 'Quick',
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
  }, [addPanel, addProject, onClose, projectId, projectRoot, refreshGit, selectLeftSidebar])

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
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl animate-slide-up">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="h-11 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
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

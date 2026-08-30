import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileEntry } from '@shared/contracts/filesystem'
import type { GitChangeStatus } from '@shared/contracts/git'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useEditorStore } from '@renderer/stores/editor-store'
import { pathHasGitChanges, useGitStore } from '@renderer/stores/git-store'
import { getFileIconSpec } from '@renderer/lib/file-icons'
import { cn } from '@renderer/lib/utils'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Search,
  X
} from 'lucide-react'

interface DirectoryNodeProps {
  entry: FileEntry
  depth: number
  projectRoot: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  selectedFile: string | null
  onSelectFile: (path: string) => void
  getGitStatus: (path: string, isDirectory: boolean) => GitChangeStatus | null
}

const gitStatusColor: Record<GitChangeStatus, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-error',
  U: 'text-info'
}

function toRelative(projectRoot: string, absolutePath: string): string {
  return absolutePath
    .replace(projectRoot, '')
    .replace(/^[/\\]/, '')
    .replace(/\\/g, '/')
}

function DirectoryNode({
  entry,
  depth,
  projectRoot,
  expandedPaths,
  onToggle,
  selectedFile,
  onSelectFile,
  getGitStatus
}: DirectoryNodeProps): React.JSX.Element {
  const [children, setChildren] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const isExpanded = expandedPaths.has(entry.path)

  const loadChildren = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.fs.readDirectory({
        projectRoot,
        directoryPath: entry.path
      })
      setChildren(result.entries)
    } catch {
      setChildren([])
    } finally {
      setLoading(false)
    }
  }, [entry.path, projectRoot])

  useEffect(() => {
    if (isExpanded && children.length === 0 && !loading) {
      void loadChildren()
    }
  }, [isExpanded, children.length, loading, loadChildren])

  const paddingLeft = 8 + depth * 14

  if (entry.type === 'directory') {
    const folderStatus = getGitStatus(entry.path, true)
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(entry.path)}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-hover',
            folderStatus
              ? cn(gitStatusColor[folderStatus], 'hover:opacity-90')
              : 'text-text-secondary hover:text-text-primary'
          )}
          style={{ paddingLeft }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-info" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-info" />
          )}
          <span className="truncate font-medium">{entry.name}</span>
          {folderStatus && (
            <span className={cn('ml-auto font-mono text-[10px] font-semibold', gitStatusColor[folderStatus])}>
              •
            </span>
          )}
        </button>
        {isExpanded && (
          <div>
            {loading && (
              <p
                className="py-1 text-[10px] text-text-muted"
                style={{ paddingLeft: paddingLeft + 20 }}
              >
                Loading...
              </p>
            )}
            {children.map((child) => (
              <DirectoryNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                projectRoot={projectRoot}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                getGitStatus={getGitStatus}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const gitStatus = getGitStatus(entry.path, false)
  const relativePath = toRelative(projectRoot, entry.path)
  const icon = getFileIconSpec(entry.name)
  const Icon = icon.icon
  const isSelected = selectedFile === relativePath || selectedFile === entry.path

  return (
    <button
      type="button"
      onClick={() => onSelectFile(entry.path)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-hover',
        isSelected && 'bg-primary/10',
        gitStatus
          ? cn(gitStatusColor[gitStatus], 'font-medium')
          : isSelected
            ? 'text-text-primary'
            : 'text-text-secondary hover:text-text-primary'
      )}
      style={{ paddingLeft: paddingLeft + 16 }}
      title={gitStatus ? `${relativePath} (${gitStatus})` : relativePath}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', icon.className)} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {gitStatus && (
        <span className={cn('font-mono text-[10px] font-semibold', gitStatusColor[gitStatus])}>
          {gitStatus}
        </span>
      )}
    </button>
  )
}

export function FileExplorerPanel(): React.JSX.Element {
  const { projectId, projectRoot } = useActiveProject()
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntry[]>([])
  const [searching, setSearching] = useState(false)

  const selectedFile = useEditorStore((s) =>
    projectId ? s.selectedFileByProject[projectId] ?? null : null
  )
  const openFile = useEditorStore((s) => s.openFile)
  const refreshGit = useGitStore((s) => s.refresh)
  const gitStateByProject = useGitStore((s) => s.stateByProject)

  const loadRoot = useCallback(async () => {
    if (!projectRoot) {
      setRootEntries([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.api.fs.readDirectory({
        projectRoot,
        directoryPath: projectRoot
      })
      setRootEntries(result.entries)
      setExpandedPaths(new Set([projectRoot]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory')
      setRootEntries([])
    } finally {
      setLoading(false)
    }
  }, [projectRoot])

  useEffect(() => {
    void loadRoot()
    if (projectId && projectRoot) {
      void refreshGit(projectId, projectRoot)
    }
  }, [loadRoot, projectId, projectRoot, refreshGit])

  useEffect(() => {
    if (!projectRoot) {
      setSearchResults([])
      return
    }

    const trimmed = query.trim()
    if (!trimmed) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      void window.api.fs
        .search({ projectRoot, query: trimmed })
        .then((result) => {
          if (!cancelled) setSearchResults(result.entries)
        })
        .catch(() => {
          if (!cancelled) setSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectRoot, query])

  const handleToggle = (path: string): void => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleSelectFile = (path: string): void => {
    if (!projectId || !projectRoot) return
    void openFile(projectId, projectRoot, path)
  }

  const getGitStatus = useCallback(
    (absolutePath: string, isDirectory: boolean): GitChangeStatus | null => {
      if (!projectId) return null
      return pathHasGitChanges(gitStateByProject, projectId, absolutePath, isDirectory)
    },
    [gitStateByProject, projectId]
  )

  const searchItems = useMemo(() => searchResults, [searchResults])
  const isSearching = query.trim().length > 0

  if (!projectRoot) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No project folder"
        description="Click the folder icon on the project tab to select a directory"
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-2 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full rounded-md border border-border bg-app-bg py-1.5 pl-7 pr-7 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-primary/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-hover hover:text-text-primary"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
          <p className="truncate font-mono text-[9px] uppercase tracking-wider text-text-muted">
            {isSearching ? 'Search results' : projectRoot}
          </p>
          {!isSearching && (
            <button
              type="button"
              onClick={() => void loadRoot()}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1">
        {isSearching ? (
          <>
            {searching && <p className="p-2 text-xs text-text-muted">Searching...</p>}
            {!searching && searchItems.length === 0 && (
              <p className="p-2 text-xs text-text-muted">No files match “{query.trim()}”</p>
            )}
            {searchItems.map((entry) => {
              const relativePath = toRelative(projectRoot, entry.path)
              const gitStatus = getGitStatus(entry.path, false)
              const icon = getFileIconSpec(entry.name)
              const Icon = icon.icon
              const isSelected =
                selectedFile === relativePath || selectedFile === entry.path
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => handleSelectFile(entry.path)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-hover',
                    isSelected && 'bg-primary/10',
                    gitStatus
                      ? cn(gitStatusColor[gitStatus], 'font-medium')
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                  title={relativePath}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', icon.className)} />
                  <span className="min-w-0 flex-1 truncate">{relativePath}</span>
                  {gitStatus && (
                    <span
                      className={cn(
                        'font-mono text-[10px] font-semibold',
                        gitStatusColor[gitStatus]
                      )}
                    >
                      {gitStatus}
                    </span>
                  )}
                </button>
              )
            })}
          </>
        ) : (
          <>
            {loading && <p className="p-2 text-xs text-text-muted">Loading...</p>}
            {error && <p className="p-2 text-xs text-error">{error}</p>}
            {!loading &&
              rootEntries.map((entry) => (
                <DirectoryNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  projectRoot={projectRoot}
                  expandedPaths={expandedPaths}
                  onToggle={handleToggle}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  getGitStatus={getGitStatus}
                />
              ))}
          </>
        )}
      </div>
    </div>
  )
}

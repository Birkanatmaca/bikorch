import { useCallback, useEffect, useRef, useState } from 'react'
import { projectFiles, describeFileError } from '@renderer/lib/project-filesystem'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { flushPersistence } from '@renderer/lib/persistence-sync'
import type { FileEntry } from '@shared/contracts/filesystem'
import type { GitChangeStatus } from '@shared/contracts/git'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useEditorStore } from '@renderer/stores/editor-store'
import { useIdeStore } from '@renderer/stores/ide-store'
import { pathHasGitChanges, useGitStore } from '@renderer/stores/git-store'
import { getFileIconSpec } from '@renderer/lib/file-icons'
import { cn } from '@renderer/lib/utils'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { ChevronDown, ChevronRight, Folder, FolderOpen, RefreshCw, Search, X } from 'lucide-react'

interface DirectoryNodeProps {
  entry: FileEntry
  depth: number
  projectId: string
  projectRoot: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onOpenFile: (path: string) => void
  getGitStatus: (path: string, isDirectory: boolean) => GitChangeStatus | null
}

function toRelative(projectRoot: string, absolutePath: string): string {
  return absolutePath
    .replace(projectRoot, '')
    .replace(/^[/\\]/, '')
    .replace(/\\/g, '/')
}

function folderName(projectRoot: string): string {
  return projectRoot.split(/[/\\]/).filter(Boolean).pop() ?? projectRoot
}

function parentDir(relativePath: string): string {
  const parts = relativePath.split('/')
  if (parts.length < 2) return ''
  return parts.slice(0, -1).join('/')
}

function DirectoryNode({
  entry,
  depth,
  projectId,
  projectRoot,
  expandedPaths,
  onToggle,
  selectedFile,
  onSelectFile,
  onOpenFile,
  getGitStatus
}: DirectoryNodeProps): React.JSX.Element {
  const [children, setChildren] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const isExpanded = expandedPaths.has(entry.path)

  useEffect(() => {
    if (!isExpanded || entry.type !== 'directory') return
    let cancelled = false
    setLoading(true)
    setError(null)
    void projectFiles.readDirectory({ projectId, directoryPath: entry.path })
      .then((result) => {
        if (!cancelled) setChildren(result.entries)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setChildren([])
          setError(describeFileError(err))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
    }
  }, [isExpanded, entry.type, entry.path, projectId, attempt])

  if (entry.type === 'directory') {
    const folderStatus = getGitStatus(entry.path, true)
    return (
      <div className="file-tree-node">
        <button
          type="button"
          onClick={() => onToggle(entry.path)}
          aria-expanded={isExpanded}
          className={cn('file-tree-row is-folder', folderStatus && `is-git-${folderStatus}`)}
          style={{ '--tree-depth': depth } as React.CSSProperties}
        >
          <span className="file-tree-twist">
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </span>
          {isExpanded ? <FolderOpen className="file-tree-ic is-folder" /> : <Folder className="file-tree-ic is-folder" />}
          <span className="file-tree-name">{entry.name}</span>
          {folderStatus && <span className="file-tree-git">{folderStatus}</span>}
        </button>
        {isExpanded && (
          <div className="file-tree-branch">
            {loading && (
              <p className="file-tree-hint" style={{ '--tree-depth': depth + 1 } as React.CSSProperties}>
                Loading…
              </p>
            )}
            {!loading && error && (
              <div className="file-tree-inline-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
              </div>
            )}
            {!loading && !error && children.length === 0 && (
              <p className="file-tree-hint" style={{ '--tree-depth': depth + 1 } as React.CSSProperties}>Empty folder</p>
            )}
            {!loading && children.map((child) => (
              <DirectoryNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                projectId={projectId}
                projectRoot={projectRoot}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onOpenFile={onOpenFile}
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
      onDoubleClick={() => onOpenFile(entry.path)}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpenFile(entry.path) }}
      className={cn(
        'file-tree-row is-file',
        isSelected && 'is-selected',
        gitStatus && `is-git-${gitStatus}`
      )}
      style={{ '--tree-depth': depth } as React.CSSProperties}
      title={gitStatus ? `${relativePath} (${gitStatus})` : relativePath}
    >
      <span className="file-tree-twist" aria-hidden />
      <Icon className={cn('file-tree-ic', `is-${icon.kind}`)} />
      <span className="file-tree-name">{entry.name}</span>
      {gitStatus && <span className="file-tree-git">{gitStatus}</span>}
    </button>
  )
}

export function FileExplorerPanel(): React.JSX.Element {
  const { projectId, projectRoot } = useActiveProject()
  // Reset query, expansion and pending responses when the project/root changes.
  return <ProjectFileExplorer key={`${projectId}:${projectRoot}`} projectId={projectId} projectRoot={projectRoot} />
}

function ProjectFileExplorer({ projectId, projectRoot }: { projectId: string | null; projectRoot: string | null }): React.JSX.Element {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const loadGeneration = useRef(0)

  const selectedFile = useEditorStore((s) =>
    projectId ? s.selectedFileByProject[projectId] ?? null : null
  )
  const setSelectedFile = useEditorStore((s) => s.setSelectedFile)
  const openInIde = useIdeStore((s) => s.openFile)
  const refreshGit = useGitStore((s) => s.refresh)
  const gitStateByProject = useGitStore((s) => s.stateByProject)

  const loadRoot = useCallback(async () => {
    if (!projectRoot || !projectId) {
      setRootEntries([])
      return
    }

    setLoading(true)
    setError(null)
    const generation = ++loadGeneration.current

    try {
      const result = await projectFiles.readDirectory({
        projectId,
        directoryPath: projectRoot
      })
      if (generation !== loadGeneration.current) return
      setRootEntries(result.entries)
      setExpandedPaths(new Set([projectRoot]))
    } catch (err) {
      if (generation !== loadGeneration.current) return
      setError(describeFileError(err))
      setRootEntries([])
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [projectId, projectRoot])

  const retryRoot = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await flushPersistence()
      await loadRoot()
    } catch (err) {
      setError(describeFileError(err))
      setLoading(false)
    }
  }

  const reconnectFolder = async (): Promise<void> => {
    try {
      const folderPath = await window.api.selectFolder()
      if (!folderPath || !projectId) return
      const workspace = useWorkspaceStore.getState()
      if (workspace.projects.some((project) => project.id === projectId)) {
        workspace.updateProject(projectId, { folderPath })
        // Selecting the same path does not remount the explorer.
        if (folderPath === projectRoot) await loadRoot()
      }
    } catch (err) {
      setError(describeFileError(err))
    }
  }

  useEffect(() => {
    void loadRoot()
    if (projectId && projectRoot) {
      void refreshGit(projectId, projectRoot)
    }
    return () => { loadGeneration.current += 1 }
  }, [loadRoot, projectId, projectRoot, refreshGit])

  useEffect(() => {
    if (!projectRoot || !projectId) {
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
    setSearchError(null)
    setSearchResults([])
    const timer = window.setTimeout(() => {
      void projectFiles
        .search({ projectId, query: trimmed })
        .then((result) => {
          if (!cancelled) setSearchResults(result.entries)
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setSearchResults([])
            setSearchError(describeFileError(err))
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectId, projectRoot, query])

  const handleToggle = (path: string): void => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleSelectFile = (path: string): void => {
    if (!projectId || !projectRoot) return
    const relative = toRelative(projectRoot, path)
    setSelectedFile(projectId, relative || path)
  }

  const handleOpenFile = (path: string): void => {
    if (!projectId || !projectRoot) return
    handleSelectFile(path)
    void openInIde(projectId, projectRoot, path)
  }

  const getGitStatus = useCallback(
    (absolutePath: string, isDirectory: boolean): GitChangeStatus | null => {
      if (!projectId) return null
      return pathHasGitChanges(gitStateByProject, projectId, absolutePath, isDirectory)
    },
    [gitStateByProject, projectId]
  )

  const isSearching = query.trim().length > 0

  if (!projectRoot || !projectId) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No project folder"
        description="Click the folder icon on the project tab to select a directory"
      />
    )
  }

  return (
    <div className="file-tree">
      <div className="file-tree-toolbar">
        <label className="file-tree-search">
          <Search />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search files"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <X />
            </button>
          )}
        </label>
        <div className="file-tree-meta">
          <span title={projectRoot}>{isSearching ? 'Results' : folderName(projectRoot)}</span>
          {!isSearching && (
            <button type="button" onClick={() => void loadRoot()} title="Refresh" aria-label="Refresh files">
              <RefreshCw />
            </button>
          )}
        </div>
      </div>

      <div className="file-tree-list">
        {isSearching ? (
          <>
            {searching && <p className="file-tree-hint">Searching…</p>}
            {searchError && <p className="file-tree-hint is-error" role="alert">{searchError}</p>}
            {!searching && !searchError && searchResults.length === 0 && (
              <p className="file-tree-hint">No files match “{query.trim()}”</p>
            )}
            {searchResults.map((entry) => {
              const relativePath = toRelative(projectRoot, entry.path)
              const gitStatus = getGitStatus(entry.path, false)
              const icon = getFileIconSpec(entry.name)
              const Icon = icon.icon
              const isSelected = selectedFile === relativePath || selectedFile === entry.path
              const dir = parentDir(relativePath)
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => handleSelectFile(entry.path)}
                  onDoubleClick={() => handleOpenFile(entry.path)}
                  onKeyDown={(event) => { if (event.key === 'Enter') handleOpenFile(entry.path) }}
                  className={cn(
                    'file-tree-row is-file is-search',
                    isSelected && 'is-selected',
                    gitStatus && `is-git-${gitStatus}`
                  )}
                  title={relativePath}
                >
                  <Icon className={cn('file-tree-ic', `is-${icon.kind}`)} />
                  <span className="file-tree-name">{entry.name}</span>
                  {dir && <span className="file-tree-dir">{dir}</span>}
                  {gitStatus && <span className="file-tree-git">{gitStatus}</span>}
                </button>
              )
            })}
          </>
        ) : (
          <>
            {loading && <p className="file-tree-hint">Loading…</p>}
            {error && (
              <div className="file-tree-error" role="alert">
                <FolderOpen aria-hidden />
                <strong>Let’s reconnect your files</strong>
                <p>{error}</p>
                <button type="button" onClick={() => void retryRoot()}>Try again</button>
                <button type="button" onClick={() => void reconnectFolder()}>Open project folder</button>
              </div>
            )}
            {!loading && !error && rootEntries.length === 0 && (
              <div className="file-tree-empty"><FolderOpen aria-hidden /><strong>A little room to build</strong><p>No visible files in this folder yet. Hidden and generated folders are excluded.</p></div>
            )}
            {!loading &&
              rootEntries.map((entry) => (
                <DirectoryNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  projectId={projectId}
                  projectRoot={projectRoot}
                  expandedPaths={expandedPaths}
                  onToggle={handleToggle}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  onOpenFile={handleOpenFile}
                  getGitStatus={getGitStatus}
                />
              ))}
          </>
        )}
      </div>
    </div>
  )
}

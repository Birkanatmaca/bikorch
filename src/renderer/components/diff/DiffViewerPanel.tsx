import { DiffEditor, Editor } from '@monaco-editor/react'
import { useState } from 'react'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useEditorStore } from '@renderer/stores/editor-store'
import { selectGitBundle, selectGitChanges, useGitStore } from '@renderer/stores/git-store'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileCode2,
  RefreshCw,
  Rows3
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export function DiffViewerPanel(): React.JSX.Element {
  const { projectId, projectRoot } = useActiveProject()
  const [sideBySide, setSideBySide] = useState(false)

  const activeDiff = useEditorStore((s) =>
    projectId ? s.activeDiffByProject[projectId] ?? null : null
  )
  const diffContent = useEditorStore((s) =>
    projectId ? s.diffContentByProject[projectId] ?? null : null
  )
  const loading = useEditorStore((s) =>
    projectId ? s.diffLoadingByProject[projectId] ?? false : false
  )
  const error = useEditorStore((s) =>
    projectId ? s.diffErrorByProject[projectId] ?? null : null
  )

  const navigateDiff = useEditorStore((s) => s.navigateDiff)
  const refreshDiff = useEditorStore((s) => s.refreshDiff)
  const gitChanges = useGitStore((s) => selectGitChanges(s.stateByProject, projectId))
  const selectedRoot = useGitStore(
    (s) => selectGitBundle(s.stateByProject, projectId).selectedRoot
  )
  const repoRoot = selectedRoot ?? projectRoot
  const isFileMode = activeDiff?.mode === 'file'
  const isDiffMode = activeDiff?.mode === 'diff'

  const handleNavigate = (direction: 'prev' | 'next'): void => {
    if (!projectId || !repoRoot || !isDiffMode) return
    void navigateDiff(projectId, repoRoot, direction)
  }

  const handleRefresh = (): void => {
    if (!projectId || !repoRoot) return
    void refreshDiff(projectId, repoRoot)
    if (projectRoot) {
      void useGitStore.getState().refresh(projectId, projectRoot)
    }
  }

  if (!activeDiff && !loading) {
    return (
      <EmptyState
        icon={FileCode2}
        title="Code Review"
        description="Open a file from Files or pick a change to review"
      />
    )
  }

  if (loading && !diffContent) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        Loading file content...
      </div>
    )
  }

  if (error && !diffContent) {
    return (
      <EmptyState icon={FileCode2} title="Could not open file" description={error} />
    )
  }

  if (!diffContent) {
    return (
      <EmptyState
        icon={FileCode2}
        title="Code Review"
        description="Open a file from Files or pick a change to review"
      />
    )
  }

  const currentIndex = activeDiff?.index ?? 0
  const total = isDiffMode ? gitChanges.length : 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-elevated px-2 py-1.5">
        {isDiffMode && (
          <>
            <button
              type="button"
              onClick={() => handleNavigate('prev')}
              disabled={total <= 1}
              className="rounded p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:opacity-40"
              title="Previous"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('next')}
              disabled={total <= 1}
              className="rounded p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:opacity-40"
              title="Next"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            Code Review
            {isFileMode ? ' · File' : activeDiff?.status ? ` · ${activeDiff.status}` : ''}
          </p>
          <p className="truncate font-mono text-[10px] text-text-secondary">
            {diffContent.filePath}
            {total > 0 && (
              <span className="ml-2 text-text-muted">
                ({currentIndex + 1}/{total})
              </span>
            )}
          </p>
        </div>

        {isDiffMode && (
          <button
            type="button"
            onClick={() => setSideBySide((value) => !value)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            title={sideBySide ? 'Unified view' : 'Side by side'}
          >
            {sideBySide ? <Rows3 className="h-3 w-3" /> : <Columns2 className="h-3 w-3" />}
            {sideBySide ? 'Unified' : 'Split'}
          </button>
        )}

        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="border-b border-error/30 bg-error/10 px-3 py-1.5 text-xs text-error">
          {error}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {isFileMode ? (
          <Editor
            key={`file:${diffContent.filePath}`}
            height="100%"
            width="100%"
            value={diffContent.modified}
            language={diffContent.language}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              lineNumbers: 'on',
              wordWrap: 'on',
              automaticLayout: true,
              padding: { top: 8, bottom: 8 }
            }}
            loading={
              <div className="flex h-full items-center justify-center text-xs text-text-muted">
                Loading editor...
              </div>
            }
          />
        ) : (
          <DiffEditor
            key={`${diffContent.filePath}:${sideBySide ? 'split' : 'unified'}`}
            height="100%"
            width="100%"
            original={diffContent.original}
            modified={diffContent.modified}
            language={diffContent.language}
            theme="vs-dark"
            options={{
              readOnly: true,
              originalEditable: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              lineNumbers: 'on',
              renderSideBySide: sideBySide,
              useInlineViewWhenSpaceIsLimited: false,
              renderIndicators: true,
              renderMarginRevertIcon: false,
              ignoreTrimWhitespace: false,
              wordWrap: 'on',
              diffWordWrap: 'on',
              automaticLayout: true,
              padding: { top: 8, bottom: 8 }
            }}
            loading={
              <div className="flex h-full items-center justify-center text-xs text-text-muted">
                Loading editor...
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

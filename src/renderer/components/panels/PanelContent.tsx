import { Suspense, lazy } from 'react'
import { type PanelType } from '@shared/types'
import type { PtyKind } from '@shared/contracts/pty'
import type { PtyLaunchMode } from '@shared/contracts/pty'
import { Loader2 } from 'lucide-react'

const TerminalView = lazy(() =>
  import('@renderer/components/terminal/TerminalView').then((m) => ({ default: m.TerminalView }))
)
const FileExplorerPanel = lazy(() =>
  import('@renderer/components/file-explorer/FileExplorerPanel').then((m) => ({
    default: m.FileExplorerPanel
  }))
)
const GitChangesPanel = lazy(() =>
  import('@renderer/components/git/GitChangesPanel').then((m) => ({ default: m.GitChangesPanel }))
)
const DiffViewerPanel = lazy(() =>
  import('@renderer/components/diff/DiffViewerPanel').then((m) => ({ default: m.DiffViewerPanel }))
)
const WebChatPanel = lazy(() =>
  import('@renderer/components/chatgpt/ChatGPTPanel').then((m) => ({ default: m.WebChatPanel }))
)
const LimitsPanel = lazy(() =>
  import('@renderer/components/usage/LimitsPanel').then((m) => ({ default: m.LimitsPanel }))
)
const LogsPanel = lazy(() =>
  import('@renderer/components/logs/LogsPanel').then((m) => ({ default: m.LogsPanel }))
)
const TasksPanel = lazy(() =>
  import('@renderer/components/tasks/TasksPanel').then((m) => ({ default: m.TasksPanel }))
)

interface PanelContentProps {
  panelId: string
  type: PanelType
  launchMode?: PtyLaunchMode
  accountId?: string
}

function panelTypeToPtyKind(type: PanelType): PtyKind | null {
  switch (type) {
    case 'terminal':
      return 'terminal'
    case 'claude':
      return 'claude'
    case 'cursor':
      return 'cursor'
    case 'gemini':
      return 'gemini'
    case 'antigravity':
      return 'antigravity'
    case 'codex':
      return 'codex'
    default:
      return null
  }
}

function PanelLoading(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
    </div>
  )
}

function PlaceholderLines({ count = 4 }: { count?: number }): React.JSX.Element {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-2 rounded-sm bg-hover"
          style={{ width: `${60 + (i * 13) % 35}%`, opacity: 0.4 + (i % 3) * 0.15 }}
        />
      ))}
    </div>
  )
}

export function PanelContent({ panelId, type, launchMode, accountId }: PanelContentProps): React.JSX.Element {
  const ptyKind = panelTypeToPtyKind(type)

  if (ptyKind) {
    return (
      <Suspense fallback={<PanelLoading />}>
        <TerminalView
          sessionId={panelId}
          kind={ptyKind}
          launchMode={launchMode}
          accountId={accountId}
        />
      </Suspense>
    )
  }

  switch (type) {
    case 'file-explorer':
      return (
        <Suspense fallback={<PanelLoading />}>
          <FileExplorerPanel />
        </Suspense>
      )
    case 'git-changes':
      return (
        <Suspense fallback={<PanelLoading />}>
          <GitChangesPanel />
        </Suspense>
      )
    case 'diff':
      return (
        <Suspense fallback={<PanelLoading />}>
          <DiffViewerPanel />
        </Suspense>
      )
    case 'chatgpt':
      return (
        <Suspense fallback={<PanelLoading />}>
          <WebChatPanel provider="chatgpt" />
        </Suspense>
      )
    case 'claude-chat':
      return (
        <Suspense fallback={<PanelLoading />}>
          <WebChatPanel provider="claude" />
        </Suspense>
      )
    case 'logs':
      return (
        <Suspense fallback={<PanelLoading />}>
          <LogsPanel />
        </Suspense>
      )
    case 'tasks':
      return (
        <Suspense fallback={<PanelLoading />}>
          <TasksPanel />
        </Suspense>
      )
    case 'usage':
      return (
        <Suspense fallback={<PanelLoading />}>
          <LimitsPanel />
        </Suspense>
      )
    default:
      return <PlaceholderLines />
  }
}

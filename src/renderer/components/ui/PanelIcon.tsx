import { Bot, CheckSquare2, Files, GitBranch, GitCompareArrows, Globe, ListTree, MessageSquare, Music2, SquareTerminal, Timer, type LucideIcon } from 'lucide-react'
import type { PanelType } from '@shared/types'
import { cn } from '@renderer/lib/utils'

const icons: Partial<Record<PanelType, LucideIcon>> = {
  terminal: SquareTerminal,
  'file-explorer': Files,
  'git-changes': GitBranch,
  diff: GitCompareArrows,
  logs: ListTree,
  tasks: CheckSquare2,
  player: Music2,
  timer: Timer,
  browser: Globe,
  chatgpt: MessageSquare,
  'claude-chat': MessageSquare
}

export function PanelIcon({ type, className }: { type: PanelType; className?: string }): React.JSX.Element {
  const Icon = icons[type] ?? Bot
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', className)} strokeWidth={1.6} aria-hidden />
}

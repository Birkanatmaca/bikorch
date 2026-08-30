import { useCallback, useState } from 'react'
import { Bot, GitBranch, Keyboard, MessageCircle, Sparkles, Terminal, X } from 'lucide-react'
import { clampOrchestratorRect, DEFAULT_ORCHESTRATOR_RECT } from '@shared/types'
import type { PanelType } from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import {
  type ContextMenuGroup,
  rectFromCanvasClick
} from '@renderer/components/ui/ContextMenu'
import { COMMAND_PALETTE_EVENT } from '@renderer/lib/app-events'

interface MenuState {
  x: number
  y: number
  canvasX: number
  canvasY: number
  targetPanelId: string | null
}

export function useOrchestratorContextMenu(getCanvasRect: () => DOMRect | null): {
  menu: MenuState | null
  groups: ContextMenuGroup[]
  openAt: (e: React.MouseEvent, targetPanelId?: string | null) => void
  close: () => void
} {
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const removePanel = useWorkspaceStore((s) => s.removePanel)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const close = useCallback(() => setMenu(null), [])

  const openAt = useCallback((e: React.MouseEvent, targetPanelId: string | null = null) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: e.clientX,
      canvasY: e.clientY,
      targetPanelId
    })
  }, [])

  const addAtCursor = useCallback(
    (type: PanelType) => {
      if (!menu) return
      const canvas = getCanvasRect()
      const box = canvas ?? new DOMRect(0, 0, 1, 1)
      const rect = clampOrchestratorRect(
        rectFromCanvasClick(box, menu.canvasX, menu.canvasY, {
          w: DEFAULT_ORCHESTRATOR_RECT.w,
          h: DEFAULT_ORCHESTRATOR_RECT.h
        })
      )
      addPanel(type, 'center', rect)
    },
    [addPanel, getCanvasRect, menu]
  )

  const groups: ContextMenuGroup[] = [
    {
      id: 'add',
      items: [
        {
          id: 'add-terminal',
          label: 'Add Terminal',
          shortcut: 'Ctrl+`',
          icon: Terminal,
          action: () => addAtCursor('terminal')
        },
        {
          id: 'add-claude',
          label: 'Add Claude Code',
          icon: Bot,
          action: () => addAtCursor('claude')
        },
        {
          id: 'add-cursor',
          label: 'Add Cursor CLI',
          icon: Sparkles,
          action: () => addAtCursor('cursor')
        },
        {
          id: 'add-gemini',
          label: 'Open Gemini CLI',
          icon: Sparkles,
          action: () => addAtCursor('gemini')
        },
        {
          id: 'add-antigravity',
          label: 'Open Antigravity CLI',
          icon: Sparkles,
          action: () => addAtCursor('antigravity')
        },
        {
          id: 'add-codex',
          label: 'Open Codex CLI',
          icon: Sparkles,
          action: () => addAtCursor('codex')
        },
        {
          id: 'add-chatgpt',
          label: 'Open ChatGPT',
          icon: MessageCircle,
          action: () => addAtCursor('chatgpt')
        },
        {
          id: 'add-claude-chat',
          label: 'Open Claude',
          icon: Bot,
          action: () => addAtCursor('claude-chat')
        },
        {
          id: 'add-git',
          label: 'Add Git Changes',
          icon: GitBranch,
          action: () => addAtCursor('git-changes')
        }
      ]
    },
    {
      id: 'tools',
      items: [
        {
          id: 'palette',
          label: 'Command Palette',
          shortcut: 'Ctrl+K',
          icon: Keyboard,
          action: () => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))
        }
      ]
    }
  ]

  if (menu?.targetPanelId) {
    const panelId = menu.targetPanelId
    groups.push({
      id: 'panel',
      items: [
        {
          id: 'close-panel',
          label: 'Close this panel',
          danger: true,
          icon: X,
          action: () => removePanel(panelId)
        }
      ]
    })
  }

  return { menu, groups, openAt, close }
}

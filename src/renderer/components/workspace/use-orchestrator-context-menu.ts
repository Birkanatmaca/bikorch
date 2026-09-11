import { useCallback, useState } from 'react'
import {
  Bot,
  GitBranch,
  Keyboard,
  MessageCircle,
  Music2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Sparkles,
  Terminal,
  Timer,
  Globe,
  X
} from 'lucide-react'
import {
  clampOrchestratorRect,
  DEFAULT_CHAT_RECT,
  DEFAULT_ORCHESTRATOR_RECT,
  DEFAULT_PLAYER_RECT,
  DEFAULT_TIMER_RECT,
  floatingWidgetLimits,
  isFloatingWidget,
  isWebChatPanel,
  panelMinLimits
} from '@shared/types'
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

export function useOrchestratorContextMenu(
  getCanvasRect: () => DOMRect | null,
  tiled = false
): {
  menu: MenuState | null
  groups: ContextMenuGroup[]
  openAt: (e: React.MouseEvent, targetPanelId?: string | null) => void
  close: () => void
} {
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const removePanel = useWorkspaceStore((s) => s.removePanel)
  const splitTiledPanel = useWorkspaceStore((s) => s.splitTiledPanel)
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
      const measured = canvas ? { w: canvas.width, h: canvas.height } : undefined
      const size = isFloatingWidget(type)
        ? type === 'timer'
          ? { w: DEFAULT_TIMER_RECT.w, h: DEFAULT_TIMER_RECT.h }
          : { w: DEFAULT_PLAYER_RECT.w, h: DEFAULT_PLAYER_RECT.h }
        : isWebChatPanel(type)
          ? { w: DEFAULT_CHAT_RECT.w, h: DEFAULT_CHAT_RECT.h }
          : { w: DEFAULT_ORCHESTRATOR_RECT.w, h: DEFAULT_ORCHESTRATOR_RECT.h }
      const rect = clampOrchestratorRect(
        rectFromCanvasClick(box, menu.canvasX, menu.canvasY, size),
        floatingWidgetLimits(type, measured) ?? panelMinLimits(type, measured)
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
          label: 'Terminal',
          shortcut: 'Ctrl+`',
          icon: Terminal,
          action: () => addAtCursor('terminal')
        },
        {
          id: 'add-claude',
          label: 'Claude',
          icon: Bot,
          action: () => addAtCursor('claude')
        },
        {
          id: 'add-cursor',
          label: 'Cursor',
          icon: Sparkles,
          action: () => addAtCursor('cursor')
        },
        {
          id: 'add-gemini',
          label: 'Gemini',
          icon: Sparkles,
          action: () => addAtCursor('gemini')
        },
        {
          id: 'add-antigravity',
          label: 'Antigravity',
          icon: Sparkles,
          action: () => addAtCursor('antigravity')
        },
        {
          id: 'add-codex',
          label: 'Codex',
          icon: Sparkles,
          action: () => addAtCursor('codex')
        },
        {
          id: 'add-chatgpt',
          label: 'ChatGPT',
          icon: MessageCircle,
          action: () => addAtCursor('chatgpt')
        },
        {
          id: 'add-claude-chat',
          label: 'Claude Chat',
          icon: Bot,
          action: () => addAtCursor('claude-chat')
        },
        {
          id: 'add-player',
          label: 'Player',
          icon: Music2,
          action: () => addAtCursor('player')
        },
        {
          id: 'add-timer',
          label: 'Timer',
          icon: Timer,
          action: () => addAtCursor('timer')
        },
        {
          id: 'add-browser',
          label: 'Browser',
          icon: Globe,
          action: () => addAtCursor('browser')
        },
        {
          id: 'add-git',
          label: 'Git Changes',
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
    if (tiled) {
      groups.push({
        id: 'split',
        items: [
          {
            id: 'split-left',
            label: 'Split Left',
            icon: PanelLeft,
            action: () => void splitTiledPanel(panelId, 'left')
          },
          {
            id: 'split-right',
            label: 'Split Right',
            icon: PanelRight,
            action: () => void splitTiledPanel(panelId, 'right')
          },
          {
            id: 'split-up',
            label: 'Split Up',
            icon: PanelTop,
            action: () => void splitTiledPanel(panelId, 'up')
          },
          {
            id: 'split-down',
            label: 'Split Down',
            icon: PanelBottom,
            action: () => void splitTiledPanel(panelId, 'down')
          }
        ]
      })
    }
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

import { useEffect, useRef, useState } from 'react'
import { ProjectTabs } from '../workspace/ProjectTabs'
import { AddPanelMenu } from '../workspace/AddPanelMenu'
import { AppLogo } from '../brand/AppLogo'
import { MenuBar } from './MenuBar'
import { TitleBarControls } from './TitleBarControls'
import { isWindows } from '@renderer/lib/electron-api'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import { cn } from '@renderer/lib/utils'
import { ChevronDown, MessageCircle } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

interface AppHeaderProps {
  showWorkspaceControls?: boolean
  onCommandPalette?: () => void
}

export function AppHeader({
  showWorkspaceControls = true,
  onCommandPalette
}: AppHeaderProps): React.JSX.Element {
  const isWin = isWindows()
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const chatgptLogo = getCliLogo('chatgpt')
  const claudeChatLogo = getCliLogo('claude-chat')
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const chatMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chatMenuOpen) return

    const handleClickOutside = (event: MouseEvent): void => {
      if (!chatMenuRef.current?.contains(event.target as Node)) {
        setChatMenuOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setChatMenuOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [chatMenuOpen])

  const openChatPanel = (type: 'chatgpt' | 'claude-chat'): void => {
    addPanel(type, 'right')
    setChatMenuOpen(false)
  }

  return (
    <header
      className={cn(
        'flex h-9 shrink-0 items-center border-b border-border bg-panel-bg',
        isWin && 'app-drag-region',
        isWin ? 'pl-0 pr-0' : 'px-2'
      )}
    >
      <div className="flex shrink-0 items-center pl-2.5 app-no-drag">
        <AppLogo size="xs" className="opacity-90" />
        <div className="mx-1.5 h-4 w-px bg-border" />
        <MenuBar onCommandPalette={onCommandPalette} />
      </div>

      {showWorkspaceControls && (
        <>
          <div className="mx-2 h-4 w-px shrink-0 bg-border" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <ProjectTabs />
          </div>
        </>
      )}

      {!showWorkspaceControls && <div className="min-h-full min-w-8 flex-1" aria-hidden />}

      <div className="flex shrink-0 items-center gap-1.5 pr-1 app-no-drag">
        {showWorkspaceControls && <AddPanelMenu />}
        {showWorkspaceControls && (
          <div ref={chatMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setChatMenuOpen((open) => !open)}
              className={cn(
                'app-no-drag flex h-7 items-center gap-0.5 rounded-md border px-1.5 text-text-secondary transition-all duration-150',
                'hover:border-primary/40 hover:bg-hover hover:text-text-primary',
                chatMenuOpen ? 'border-primary/50 bg-hover text-text-primary' : 'border-border'
              )}
              title="Open chat assistant"
              aria-label="Open chat assistant"
              aria-expanded={chatMenuOpen}
              aria-haspopup="menu"
            >
              <MessageCircle className="h-3.5 w-3.5 text-primary" />
              <ChevronDown className="h-3 w-3 text-text-muted" />
            </button>
            {chatMenuOpen && (
              <div className="app-no-drag absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-elevated py-1 shadow-xl animate-slide-up">
                <p className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  Open chat
                </p>
                <button
                  type="button"
                  onClick={() => openChatPanel('chatgpt')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                >
                  <img
                    src={chatgptLogo ?? undefined}
                    alt=""
                    className={CLI_LOGO_CLASS}
                  />
                  ChatGPT
                </button>
                <button
                  type="button"
                  onClick={() => openChatPanel('claude-chat')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                >
                  <img
                    src={claudeChatLogo ?? undefined}
                    alt=""
                    className={CLI_LOGO_CLASS}
                  />
                  Claude
                </button>
              </div>
            )}
          </div>
        )}
        <TitleBarControls />
      </div>
    </header>
  )
}

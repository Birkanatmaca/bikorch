import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  attachWebChat,
  detachWebChat,
  isWebChatReady,
  setWebChatZoom,
  WEB_CHAT_SERVICES,
  type WebChatProvider
} from '@renderer/lib/web-chat-runtime'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

export type { WebChatProvider }

export function WebChatPanel({ provider }: { provider: WebChatProvider }): React.JSX.Element {
  const service = WEB_CHAT_SERVICES[provider]
  const webviewContainerRef = useRef<HTMLDivElement>(null)
  const workspaceScale = useWorkspaceStore((state) => state.workspaceScale)
  const [loading, setLoading] = useState(() => !isWebChatReady(provider))

  useEffect(() => {
    setWebChatZoom(workspaceScale / 100)
  }, [workspaceScale])

  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    const guest = attachWebChat(provider, container)
    setLoading(!isWebChatReady(provider))

    const handleStartLoading = (): void => setLoading(true)
    const handleStopLoading = (): void => setLoading(false)
    guest.addEventListener('did-start-loading', handleStartLoading)
    guest.addEventListener('did-stop-loading', handleStopLoading)

    return () => {
      guest.removeEventListener('did-start-loading', handleStartLoading)
      guest.removeEventListener('did-stop-loading', handleStopLoading)
      detachWebChat(provider, container)
    }
  }, [provider])

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div ref={webviewContainerRef} className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {loading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-app-bg/90 text-text-muted">
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading {service.label}…
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

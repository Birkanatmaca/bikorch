import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

export type WebChatProvider = 'chatgpt' | 'claude'

const WEB_CHAT_SERVICES: Record<WebChatProvider, { label: string; url: string; partition: string }> = {
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    partition: 'persist:chatgpt'
  },
  claude: {
    label: 'Claude',
    url: 'https://claude.ai/',
    partition: 'persist:claude-chat'
  }
}

export function WebChatPanel({ provider }: { provider: WebChatProvider }): React.JSX.Element {
  const service = WEB_CHAT_SERVICES[provider]
  const webviewContainerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const container = webviewContainerRef.current
    if (!container) return

    const webview = document.createElement('webview')
    webview.setAttribute('src', service.url)
    webview.setAttribute('partition', service.partition)
    webview.setAttribute('allowpopups', '')
    webview.className = 'h-full w-full border-0'

    const handleStartLoading = (): void => setLoading(true)
    const handleStopLoading = (): void => setLoading(false)

    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    container.appendChild(webview)

    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
      webview.remove()
    }
  }, [provider, service.partition, service.url])

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

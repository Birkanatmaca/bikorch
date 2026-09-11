export type WebChatProvider = 'chatgpt' | 'claude'

type WebChatGuest = HTMLElement & {
  setZoomFactor?: (factor: number) => void
}

export const WEB_CHAT_SERVICES: Record<
  WebChatProvider,
  { label: string; url: string; partition: string }
> = {
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

const guests = new Map<WebChatProvider, WebChatGuest>()
const ready = new Map<WebChatProvider, boolean>()
let desiredZoom = 1
let park: HTMLDivElement | null = null

function ensurePark(): HTMLDivElement {
  if (park && park.isConnected) return park
  park = document.createElement('div')
  park.setAttribute('data-web-chat-park', '')
  park.style.cssText =
    'position:fixed;left:-12000px;top:0;width:400px;height:400px;overflow:hidden;opacity:0;pointer-events:none;'
  document.body.appendChild(park)
  return park
}

function applyZoom(guest: WebChatGuest): void {
  if (typeof guest.setZoomFactor === 'function') {
    try {
      guest.setZoomFactor(desiredZoom)
      guest.style.zoom = ''
      return
    } catch {
      // Guest may not be ready yet; fall through to CSS zoom.
    }
  }
  guest.style.zoom = String(desiredZoom)
}

function getOrCreateGuest(provider: WebChatProvider): WebChatGuest {
  const existing = guests.get(provider)
  if (existing) return existing

  const service = WEB_CHAT_SERVICES[provider]
  const guest = document.createElement('webview') as WebChatGuest
  guest.setAttribute('src', service.url)
  guest.setAttribute('partition', service.partition)
  guest.setAttribute('allowpopups', '')
  guest.className = 'web-chat-guest h-full w-full border-0'
  guest.addEventListener('dom-ready', () => {
    ready.set(provider, true)
    applyZoom(guest)
  })
  guests.set(provider, guest)
  ensurePark().appendChild(guest)
  return guest
}

export function isWebChatReady(provider: WebChatProvider): boolean {
  return ready.get(provider) === true
}

export function setWebChatZoom(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  desiredZoom = factor
  for (const guest of guests.values()) applyZoom(guest)
}

export function attachWebChat(provider: WebChatProvider, container: HTMLElement): WebChatGuest {
  const guest = getOrCreateGuest(provider)
  if (guest.parentElement !== container) container.appendChild(guest)
  applyZoom(guest)
  return guest
}

export function detachWebChat(provider: WebChatProvider, container: HTMLElement): void {
  const guest = guests.get(provider)
  if (!guest || guest.parentElement !== container) return
  ensurePark().appendChild(guest)
}

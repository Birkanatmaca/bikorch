import { IdleDestroyController } from '@renderer/lib/idle-destroy'
import { currentResourceLimits } from '@renderer/lib/resource-limits'

export type WebChatProvider = 'chatgpt' | 'claude'
export type WebChatLifecycle = 'active' | 'idle' | 'destroyed'

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

interface WebChatSlot {
  provider: WebChatProvider
  guest: WebChatGuest
  lifecycle: WebChatLifecycle
  attached: number
  idle: IdleDestroyController
}

const slots = new Map<WebChatProvider, WebChatSlot>()
const ready = new Map<WebChatProvider, boolean>()
let desiredZoom = 1

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

function destroyGuest(guest: WebChatGuest): void {
  try {
    guest.setAttribute('src', 'about:blank')
  } catch {
    // already gone
  }
  guest.remove()
}

function destroySlot(provider: WebChatProvider): void {
  const slot = slots.get(provider)
  if (!slot) return
  if (slot.attached > 0) return
  slot.idle.dispose()
  destroyGuest(slot.guest)
  slots.delete(provider)
  ready.delete(provider)
}

function createGuest(provider: WebChatProvider): WebChatGuest {
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
  return guest
}

function getOrCreateSlot(provider: WebChatProvider): WebChatSlot {
  const existing = slots.get(provider)
  if (existing && existing.lifecycle !== 'destroyed') return existing

  const guest = createGuest(provider)
  const slot: WebChatSlot = {
    provider,
    guest,
    lifecycle: 'idle',
    attached: 0,
    idle: new IdleDestroyController(
      () => currentResourceLimits().webChatIdleMs,
      () => destroySlot(provider)
    )
  }
  slots.set(provider, slot)
  return slot
}

export function isWebChatReady(provider: WebChatProvider): boolean {
  return ready.get(provider) === true
}

export function getWebChatLifecycle(provider: WebChatProvider): WebChatLifecycle {
  return slots.get(provider)?.lifecycle ?? 'destroyed'
}

export function countWebChatGuests(): number {
  return slots.size
}

export function setWebChatZoom(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  desiredZoom = factor
  for (const slot of slots.values()) applyZoom(slot.guest)
}

export function attachWebChat(provider: WebChatProvider, container: HTMLElement): WebChatGuest {
  const slot = getOrCreateSlot(provider)
  slot.idle.stayActive()
  slot.attached += 1
  slot.lifecycle = 'active'
  if (slot.guest.parentElement !== container) container.appendChild(slot.guest)
  applyZoom(slot.guest)
  return slot.guest
}

export function detachWebChat(provider: WebChatProvider, container: HTMLElement): void {
  const slot = slots.get(provider)
  if (!slot || slot.guest.parentElement !== container) return
  slot.attached = Math.max(0, slot.attached - 1)
  slot.guest.remove()
  if (slot.attached > 0) return
  slot.lifecycle = 'idle'
  slot.idle.beginIdle()
}

export function resetWebChatRuntime(): void {
  for (const provider of [...slots.keys()]) {
    const slot = slots.get(provider)
    if (!slot) continue
    slot.attached = 0
    slot.idle.dispose()
    destroyGuest(slot.guest)
    slots.delete(provider)
  }
  ready.clear()
}

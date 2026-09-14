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

const OFFSCREEN_PARK =
  'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;z-index:0'

interface WebChatSlot {
  provider: WebChatProvider
  guest: WebChatGuest
  park: HTMLElement
  container: HTMLElement | null
  lifecycle: WebChatLifecycle
  attached: number
  idle: IdleDestroyController
  resize: ResizeObserver | null
}

const slots = new Map<WebChatProvider, WebChatSlot>()
const ready = new Map<WebChatProvider, boolean>()
let desiredZoom = 1
let windowLayoutBound = false
let layoutTimer: ReturnType<typeof globalThis.setInterval> | null = null

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

function applyParkLayout(park: HTMLElement, container: HTMLElement | null): void {
  if (container) {
    const rect = container.getBoundingClientRect()
    park.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${Math.max(1, rect.width)}px;height:${Math.max(1, rect.height)}px;overflow:hidden;pointer-events:auto;z-index:4`
    park.removeAttribute('aria-hidden')
    return
  }
  park.style.cssText = OFFSCREEN_PARK
  park.setAttribute('aria-hidden', 'true')
}

function bindParkLayout(slot: WebChatSlot): void {
  slot.resize?.disconnect()
  slot.resize = null
  applyParkLayout(slot.park, slot.container)
  if (!slot.container || typeof ResizeObserver === 'undefined') return
  slot.resize = new ResizeObserver(() => applyParkLayout(slot.park, slot.container))
  slot.resize.observe(slot.container)
}

function layoutActiveParks(): void {
  for (const slot of slots.values()) {
    if (slot.lifecycle === 'active') applyParkLayout(slot.park, slot.container)
  }
}

function hasActiveChat(): boolean {
  for (const slot of slots.values()) {
    if (slot.lifecycle === 'active') return true
  }
  return false
}

function syncLayoutTicker(): void {
  if (hasActiveChat()) {
    if (layoutTimer == null && typeof window !== 'undefined') {
      layoutTimer = globalThis.setInterval(layoutActiveParks, 100)
    }
    return
  }
  if (layoutTimer == null) return
  globalThis.clearInterval(layoutTimer)
  layoutTimer = null
}

function bindWindowLayout(): void {
  if (windowLayoutBound || typeof window === 'undefined') return
  windowLayoutBound = true
  window.addEventListener('resize', layoutActiveParks)
}

function createPark(provider: WebChatProvider): HTMLElement {
  const node = document.createElement('div')
  node.setAttribute('data-web-chat-park', provider)
  node.setAttribute('aria-hidden', 'true')
  node.style.cssText = OFFSCREEN_PARK
  document.body.appendChild(node)
  return node
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
  slot.resize?.disconnect()
  destroyGuest(slot.guest)
  slot.park.remove()
  slots.delete(provider)
  ready.delete(provider)
  syncLayoutTicker()
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
  const park = createPark(provider)
  park.appendChild(guest)
  const slot: WebChatSlot = {
    provider,
    guest,
    park,
    container: null,
    lifecycle: 'idle',
    attached: 0,
    idle: new IdleDestroyController(
      () => currentResourceLimits().webChatIdleMs,
      () => destroySlot(provider)
    ),
    resize: null
  }
  slots.set(provider, slot)
  bindWindowLayout()
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

/** Off-screen host that keeps a detached <webview> in the DOM until idle destroy. */
export function getWebChatPark(provider?: WebChatProvider): HTMLElement | null {
  if (provider) return slots.get(provider)?.park ?? null
  return [...slots.values()][0]?.park ?? null
}

export function setWebChatZoom(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  desiredZoom = factor
  for (const slot of slots.values()) applyZoom(slot.guest)
  layoutActiveParks()
}

export function attachWebChat(provider: WebChatProvider, container: HTMLElement): WebChatGuest {
  const slot = getOrCreateSlot(provider)
  slot.idle.stayActive()
  slot.attached += 1
  slot.lifecycle = 'active'
  slot.container = container
  if (slot.guest.parentElement !== slot.park) slot.park.appendChild(slot.guest)
  bindParkLayout(slot)
  applyZoom(slot.guest)
  syncLayoutTicker()
  return slot.guest
}

export function detachWebChat(provider: WebChatProvider, container: HTMLElement): void {
  const slot = slots.get(provider)
  if (!slot || slot.container !== container) return
  slot.attached = Math.max(0, slot.attached - 1)
  if (slot.attached > 0) return
  slot.container = null
  slot.lifecycle = 'idle'
  bindParkLayout(slot)
  slot.idle.beginIdle()
  syncLayoutTicker()
}

export function resetWebChatRuntime(): void {
  for (const provider of [...slots.keys()]) {
    const slot = slots.get(provider)
    if (!slot) continue
    slot.attached = 0
    slot.container = null
    slot.idle.dispose()
    slot.resize?.disconnect()
    destroyGuest(slot.guest)
    slot.park.remove()
    slots.delete(provider)
  }
  ready.clear()
  syncLayoutTicker()
}

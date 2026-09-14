import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRendererResourceProfile } from '../resource-limits'

function fakeGuest(): HTMLElement {
  const listeners = new Map<string, EventListener>()
  const node = {
    parentElement: null as HTMLElement | null,
    isConnected: true,
    style: {} as Record<string, string>,
    className: '',
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener)
    },
    removeEventListener(type: string) {
      listeners.delete(type)
    },
    remove() {
      if (this.parentElement && 'removeChild' in this.parentElement) {
        ;(this.parentElement as HTMLElement & { removeChild: (n: unknown) => void }).removeChild(this)
      }
      this.parentElement = null
      this.isConnected = false
    }
  }
  return node as unknown as HTMLElement
}

function fakeContainer(): HTMLElement {
  const node = {
    isConnected: false,
    attributes: {} as Record<string, string>,
    style: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
    getAttribute(name: string) {
      return this.attributes[name]
    },
    removeAttribute(name: string) {
      delete this.attributes[name]
    },
    appendChild(child: { parentElement: unknown; isConnected?: boolean }) {
      child.parentElement = this
      if ('isConnected' in child) child.isConnected = true
      this.isConnected = true
      return child
    },
    removeChild(child: { parentElement: unknown; isConnected?: boolean }) {
      child.parentElement = null
      if ('isConnected' in child) child.isConnected = false
      return child
    },
    getBoundingClientRect() {
      return { left: 12, top: 24, width: 320, height: 240, right: 332, bottom: 264, x: 12, y: 24, toJSON() {} }
    },
    remove() {
      this.isConnected = false
    }
  }
  return node as unknown as HTMLElement
}

function stubDocument(): { body: HTMLElement; created: HTMLElement[] } {
  const created: HTMLElement[] = []
  const body = fakeContainer()
  vi.stubGlobal('document', {
    body,
    createElement: (tag: string) => {
      if (tag === 'webview') {
        const guest = fakeGuest()
        created.push(guest)
        return guest
      }
      expect(tag).toBe('div')
      return fakeContainer()
    }
  })
  return { body, created }
}

describe('web chat lifecycle', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('parks a detached guest until the idle timeout, then destroys it', async () => {
    vi.useFakeTimers()
    applyRendererResourceProfile('balanced')
    const { created } = stubDocument()

    const runtime = await import('../web-chat-runtime')
    runtime.resetWebChatRuntime()
    const a = fakeContainer()
    const guest = runtime.attachWebChat('chatgpt', a)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('active')
    expect(guest.parentElement).toBe(runtime.getWebChatPark('chatgpt'))

    runtime.detachWebChat('chatgpt', a)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('idle')
    expect(created).toHaveLength(1)
    expect(guest.parentElement).toBe(runtime.getWebChatPark('chatgpt'))
    expect(runtime.getWebChatPark('chatgpt')?.getAttribute('data-web-chat-park')).toBe('chatgpt')

    vi.advanceTimersByTime(59_000)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('idle')
    expect(guest.parentElement).toBe(runtime.getWebChatPark())
    vi.advanceTimersByTime(1_000)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('destroyed')
    expect(runtime.countWebChatGuests()).toBe(0)
    expect(guest.parentElement).toBeNull()

    const b = fakeContainer()
    runtime.attachWebChat('chatgpt', b)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('active')
    expect(created).toHaveLength(2)
    expect((created[1] as HTMLElement & { attributes: Record<string, string> }).attributes.partition).toBe(
      'persist:chatgpt'
    )
    runtime.resetWebChatRuntime()
  })

  it('does not destroy a guest that was reattached before the timer fires', async () => {
    vi.useFakeTimers()
    applyRendererResourceProfile('balanced')
    stubDocument()
    const runtime = await import('../web-chat-runtime')
    runtime.resetWebChatRuntime()
    const first = fakeContainer()
    const second = fakeContainer()
    runtime.attachWebChat('claude', first)
    runtime.detachWebChat('claude', first)
    runtime.attachWebChat('claude', second)
    vi.advanceTimersByTime(120_000)
    expect(runtime.getWebChatLifecycle('claude')).toBe('active')
    expect(runtime.countWebChatGuests()).toBe(1)
    runtime.resetWebChatRuntime()
  })
})

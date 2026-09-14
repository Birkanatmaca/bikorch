import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRendererResourceProfile } from '../resource-limits'

function fakeGuest(): HTMLElement {
  const listeners = new Map<string, EventListener>()
  const node = {
    parentElement: null as HTMLElement | null,
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
    }
  }
  return node as unknown as HTMLElement
}

function fakeContainer(): HTMLElement {
  const node = {
    appendChild(child: { parentElement: unknown }) {
      child.parentElement = this
      return child
    },
    removeChild(child: { parentElement: unknown }) {
      child.parentElement = null
      return child
    }
  }
  return node as unknown as HTMLElement
}

describe('web chat lifecycle', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('destroys a detached guest after the idle timeout and recreates on attach', async () => {
    vi.useFakeTimers()
    applyRendererResourceProfile('balanced')
    const created: HTMLElement[] = []
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        expect(tag).toBe('webview')
        const guest = fakeGuest()
        created.push(guest)
        return guest
      }
    })

    const runtime = await import('../web-chat-runtime')
    runtime.resetWebChatRuntime()
    const a = fakeContainer()
    runtime.attachWebChat('chatgpt', a)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('active')
    runtime.detachWebChat('chatgpt', a)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('idle')
    expect(created).toHaveLength(1)

    vi.advanceTimersByTime(59_000)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('idle')
    vi.advanceTimersByTime(1_000)
    expect(runtime.getWebChatLifecycle('chatgpt')).toBe('destroyed')
    expect(runtime.countWebChatGuests()).toBe(0)

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
    vi.stubGlobal('document', { createElement: () => fakeGuest() })
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

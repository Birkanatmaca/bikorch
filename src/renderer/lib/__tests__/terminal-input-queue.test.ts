import { describe, expect, it, vi } from 'vitest'
import { TerminalInputQueue } from '../terminal-input-queue'

describe('TerminalInputQueue', () => {
  it('holds startup input and flushes it in order when the PTY is ready', async () => {
    const writes: string[] = []
    const queue = new TerminalInputQueue(async (data) => { writes.push(data) }, vi.fn())
    queue.offer('h')
    queue.offer('i')
    expect(writes).toEqual([])
    queue.ready()
    queue.offer('\r')
    await vi.waitFor(() => expect(writes).toEqual(['h', 'i', '\r']))
  })

  it('does not let a slow submit reorder later keystrokes', async () => {
    const writes: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const queue = new TerminalInputQueue(async (data) => {
      if (data === '\r') await gate
      writes.push(data)
    }, vi.fn())
    queue.ready()
    queue.offer('a')
    queue.offer('\r')
    queue.offer('b')
    await vi.waitFor(() => expect(writes).toEqual(['a']))
    release?.()
    await vi.waitFor(() => expect(writes).toEqual(['a', '\r', 'b']))
  })

  it('drops pending input when a session closes and bounds startup buffering', async () => {
    const write = vi.fn(async () => undefined)
    const queue = new TerminalInputQueue(write, vi.fn(), 2)
    expect(queue.offer('ab')).toBe(true)
    expect(queue.offer('c')).toBe(false)
    queue.close()
    queue.ready()
    expect(queue.offer('d')).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })
})

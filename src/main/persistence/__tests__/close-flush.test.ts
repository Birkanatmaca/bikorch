import { EventEmitter } from 'events'
import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERSISTENCE_IPC } from '@shared/contracts/persistence'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    quit: vi.fn(),
    ipcMain: {
      on(channel: string, listener: (...args: unknown[]) => void) {
        const callbacks = listeners.get(channel) ?? new Set()
        callbacks.add(listener)
        listeners.set(channel, callbacks)
      },
      removeListener(channel: string, listener: (...args: unknown[]) => void) {
        listeners.get(channel)?.delete(listener)
      },
      emit(channel: string, ...args: unknown[]) {
        for (const listener of listeners.get(channel) ?? []) listener(...args)
      }
    }
  }
})

vi.mock('electron', () => ({ app: { quit: electron.quit }, ipcMain: electron.ipcMain }))

import { guardWindowPersistenceClose } from '../close-flush'

class FakeWindow extends EventEmitter {
  readonly webContents = { isDestroyed: () => false, send: vi.fn() }
  private destroyed = false

  isDestroyed(): boolean { return this.destroyed }

  close(): void {
    let prevented = false
    this.emit('close', { preventDefault: () => { prevented = true } })
    if (!prevented) {
      this.destroyed = true
      this.emit('closed')
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  electron.quit.mockClear()
})

describe('workspace close flush', () => {
  it('keeps the window open until the matching renderer acknowledges its save', () => {
    const win = new FakeWindow()
    guardWindowPersistenceClose(win as unknown as BrowserWindow, () => true, () => false)

    win.close()
    expect(win.isDestroyed()).toBe(false)
    const token = win.webContents.send.mock.calls[0]?.[1]
    electron.ipcMain.emit(PERSISTENCE_IPC.FLUSH_COMPLETE, { sender: {} }, token)
    expect(win.isDestroyed()).toBe(false)

    electron.ipcMain.emit(PERSISTENCE_IPC.FLUSH_COMPLETE, { sender: win.webContents }, token)
    expect(win.isDestroyed()).toBe(true)
  })

  it('lets a quit finish after a bounded wait when the renderer is unresponsive', () => {
    vi.useFakeTimers()
    const win = new FakeWindow()
    guardWindowPersistenceClose(win as unknown as BrowserWindow, () => true, () => true)

    win.close()
    expect(win.isDestroyed()).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(win.isDestroyed()).toBe(true)
    expect(electron.quit).toHaveBeenCalledTimes(1)
  })
})

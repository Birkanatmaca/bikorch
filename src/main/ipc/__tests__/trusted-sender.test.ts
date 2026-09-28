import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getManagedMainWindow: vi.fn() }))
vi.mock('../../lifecycle/background', () => ({ getManagedMainWindow: mocks.getManagedMainWindow }))
import { assertTrustedMainWindow } from '../trusted-sender'

function windowFixture() {
  const mainFrame = {}
  const sender = { isDestroyed: vi.fn(() => false), mainFrame }
  const win = { isDestroyed: vi.fn(() => false), webContents: sender }
  const event = { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  return { win, sender, event }
}

describe('trusted main window', () => {
  let fixture: ReturnType<typeof windowFixture>

  beforeEach(() => {
    fixture = windowFixture()
    mocks.getManagedMainWindow.mockReturnValue(fixture.win)
  })

  it('returns the managed window for its main frame', () => {
    expect(assertTrustedMainWindow(fixture.event)).toBe(fixture.win)
  })

  it('rejects webview guests and other windows even when their main frame matches', () => {
    expect(() => assertTrustedMainWindow(windowFixture().event)).toThrow('Unauthorized sender')
  })

  it('rejects an iframe within the managed window', () => {
    const event = { ...fixture.event, senderFrame: {} } as IpcMainInvokeEvent
    expect(() => assertTrustedMainWindow(event)).toThrow('Unauthorized sender')
  })

  it('rejects a missing sender frame after navigation or destruction', () => {
    expect(() => assertTrustedMainWindow({ ...fixture.event, senderFrame: null })).toThrow('Unauthorized sender')
  })

  it('rejects a destroyed sender before accessing its main frame', () => {
    fixture.sender.isDestroyed.mockReturnValue(true)
    Object.defineProperty(fixture.sender, 'mainFrame', { get: () => { throw new Error('Destroyed frame accessed') } })
    expect(() => assertTrustedMainWindow(fixture.event)).toThrow('Unauthorized sender')
  })

  it('rejects a destroyed managed window', () => {
    fixture.win.isDestroyed.mockReturnValue(true)
    expect(() => assertTrustedMainWindow(fixture.event)).toThrow('Unauthorized sender')
  })

  it('rejects requests when there is no managed window', () => {
    mocks.getManagedMainWindow.mockReturnValue(null)
    expect(() => assertTrustedMainWindow(fixture.event)).toThrow('Unauthorized sender')
  })

  it('uses the current managed window after the app recreates it', () => {
    const replacement = windowFixture()
    mocks.getManagedMainWindow.mockReturnValue(replacement.win)
    expect(() => assertTrustedMainWindow(fixture.event)).toThrow('Unauthorized sender')
    expect(assertTrustedMainWindow(replacement.event)).toBe(replacement.win)
  })
})

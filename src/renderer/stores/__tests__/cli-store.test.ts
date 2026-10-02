import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCliStore } from '../cli-store'

const detect = vi.fn()
const install = vi.fn()
const status = vi.fn()
beforeEach(() => {
  vi.stubGlobal('window', { api: { cli: { detect, install, status } } })
  useCliStore.setState({ installedByKind: {}, errorsByKind: {}, installingKind: null, installation: null })
  status.mockReset().mockResolvedValue({ installation: null })
  detect.mockReset().mockResolvedValue({ installed: false, command: null })
  install.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('CLI setup state', () => {
  it('keeps unverified CLIs unavailable if detection fails', async () => {
    detect.mockRejectedValue(new Error('IPC unavailable'))
    await useCliStore.getState().refresh()
    expect(useCliStore.getState().installedByKind.cursor).toBeUndefined()
    expect(useCliStore.getState().errorsByKind.cursor).toBe('IPC unavailable')
    expect(install).not.toHaveBeenCalled()
  })

  it('activates only after installation and a successful detection', async () => {
    let finish!: (result: { ok: boolean }) => void
    install.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const installing = useCliStore.getState().install('cursor')
    expect(useCliStore.getState().installingKind).toBe('cursor')
    expect(useCliStore.getState().installedByKind.cursor).not.toBe(true)
    expect(await useCliStore.getState().install('gemini')).toBe(false)
    detect.mockResolvedValue({ installed: true, command: 'agent' })
    finish({ ok: true })
    expect(await installing).toBe(true)
    expect(useCliStore.getState().installedByKind.cursor).toBe(true)
    expect(useCliStore.getState().installingKind).toBeNull()
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a download failure', async () => {
    install.mockResolvedValueOnce({ ok: false, error: 'Network unavailable' })
    expect(await useCliStore.getState().install('gemini')).toBe(false)
    expect(useCliStore.getState().installedByKind.gemini).toBe(false)
    expect(useCliStore.getState().errorsByKind.gemini).toBe('Network unavailable')
    install.mockResolvedValue({ ok: true })
    detect.mockResolvedValue({ installed: true, command: 'gemini' })
    expect(await useCliStore.getState().install('gemini')).toBe(true)
    expect(useCliStore.getState().errorsByKind.gemini).toBeUndefined()
  })

  it('does not activate when the installer succeeds but no executable is found', async () => {
    install.mockResolvedValue({ ok: true })
    expect(await useCliStore.getState().install('codex')).toBe(false)
    expect(useCliStore.getState().installedByKind.codex).toBe(false)
    expect(useCliStore.getState().errorsByKind.codex).toContain('not found after installation')
  })

  it('ignores detection started before installation', async () => {
    let finishOldDetection!: (value: { installed: boolean }) => void
    detect.mockReturnValueOnce(new Promise((resolve) => { finishOldDetection = resolve }))
    const oldDetection = useCliStore.getState().detect('cursor')
    install.mockResolvedValue({ ok: true })
    detect.mockResolvedValue({ installed: true, command: 'agent' })
    await useCliStore.getState().install('cursor')
    finishOldDetection({ installed: false })
    await oldDetection
    expect(useCliStore.getState().installedByKind.cursor).toBe(true)
  })

  it('restores an installation owned by the main process after renderer reload', async () => {
    status.mockResolvedValue({ installation: { kind: 'codex', phase: 'runtime', startedAt: 1, updatedAt: 2 } })
    await useCliStore.getState().refresh()
    expect(useCliStore.getState().installingKind).toBe('codex')
    expect(detect).not.toHaveBeenCalledWith('codex')
    expect(await useCliStore.getState().install('gemini')).toBe(false)
    status.mockResolvedValue({ installation: { kind: 'codex', phase: 'complete', startedAt: 1, updatedAt: 3 } })
    detect.mockResolvedValue({ installed: true, command: 'codex' })
    await useCliStore.getState().syncStatus()
    expect(useCliStore.getState().installingKind).toBeNull()
    expect(useCliStore.getState().installedByKind.codex).toBe(true)
  })

  it('preserves an interrupted download error through focus refreshes', async () => {
    status.mockResolvedValue({ installation: { kind: 'cursor', phase: 'interrupted', startedAt: 1, updatedAt: 2, error: 'Installation interrupted. Download again.' } })
    await useCliStore.getState().refresh()
    await useCliStore.getState().refresh()
    expect(useCliStore.getState().errorsByKind.cursor).toContain('interrupted')
    expect(useCliStore.getState().installingKind).toBeNull()
  })

  it('reports executable health errors instead of activating a broken CLI', async () => {
    detect.mockResolvedValue({ installed: false, command: null, error: 'Broken launcher. Repair installation.' })
    await useCliStore.getState().detect('gemini')
    expect(useCliStore.getState().installedByKind.gemini).toBe(false)
    expect(useCliStore.getState().errorsByKind.gemini).toContain('Repair')
  })

  it('retains a usable previous installation after repair fails', async () => {
    install.mockResolvedValue({ ok: false, error: 'Network failed' })
    detect.mockResolvedValue({ installed: true, command: 'codex' })
    expect(await useCliStore.getState().install('codex')).toBe(false)
    expect(useCliStore.getState().installedByKind.codex).toBe(true)
    expect(useCliStore.getState().errorsByKind.codex).toBe('Network failed')
  })
})

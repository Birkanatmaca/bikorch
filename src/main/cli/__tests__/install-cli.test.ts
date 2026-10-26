import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exec: vi.fn(), inspect: vi.fn(), ensureNode: vi.fn(), installPackage: vi.fn(), state: vi.fn() }))
vi.mock('../run-logged', () => ({ runLogged: mocks.exec, InstallCancelledError: class extends Error {} }))
vi.mock('../adapters', () => ({ terminalUserEnv: () => ({ PATH: 'tools' }) }))
vi.mock('../health', () => ({ inspectCli: mocks.inspect }))
vi.mock('../install-runtime', () => ({ ensureManagedNode: mocks.ensureNode }))
vi.mock('../setup-recovery', () => ({ initializeManagedSetup: async () => {} }))
vi.mock('../install-package', () => ({ installManagedPackage: mocks.installPackage }))
vi.mock('../install-state', () => ({ getCliSetupSnapshot: () => ({ installation: null }), setCliInstallation: mocks.state }))
import { cancelCliInstall, installCli } from '../install-cli'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.inspect.mockResolvedValueOnce({ installed: false }).mockResolvedValue({ installed: true })
  mocks.exec.mockResolvedValue(undefined)
  mocks.ensureNode.mockResolvedValue(undefined)
  mocks.installPackage.mockImplementation(async (_kind, verifying) => verifying())
})

describe('CLI installer', () => {
  it.each(['cursor', 'claude', 'antigravity'] as const)('installs %s from its official installer and verifies it', async (kind) => {
    expect(await installCli(kind)).toEqual({ ok: true })
    const [command, args, options] = mocks.exec.mock.calls[0]
    expect(command).toBe(process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
    expect(args.join(' ')).toContain(kind === 'cursor' ? 'https://cursor.com/install' : kind === 'claude' ? 'https://claude.ai/install' : 'https://antigravity.google/cli/install')
    if (process.platform === 'win32' && kind === 'cursor') expect(args.join(' ')).toContain('?win32=true')
    expect(options.windowsHide).toBe(true)
    expect(mocks.inspect).toHaveBeenCalledTimes(2)
    expect(mocks.state.mock.calls.map(([value]) => value.phase)).toEqual(['checking', 'installing', 'verifying', 'complete'])
  })

  it.each(['gemini', 'codex'] as const)('installs %s using a managed runtime and isolated package prefix', async (kind) => {
    expect(await installCli(kind)).toEqual({ ok: true })
    expect(mocks.ensureNode).toHaveBeenCalledOnce()
    expect(mocks.installPackage).toHaveBeenCalledWith(kind, expect.any(Function), expect.objectContaining({ signal: expect.any(Object) }))
    expect(mocks.state.mock.calls.map(([value]) => value.phase)).toContain('runtime')
  })

  it('does not reinstall a CLI that successfully runs', async () => {
    mocks.inspect.mockReset().mockResolvedValue({ installed: true })
    expect(await installCli('cursor')).toEqual({ ok: true })
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it('re-runs the official installer to update an installed CLI', async () => {
    mocks.inspect.mockReset().mockResolvedValue({ installed: true, version: '2.0.0' })
    expect(await installCli('claude', 'update')).toEqual({ ok: true })
    expect(mocks.exec).toHaveBeenCalledOnce()
    expect(mocks.state).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'update', phase: 'complete' }))
  })

  it('stops an installation when it is cancelled', async () => {
    mocks.exec.mockImplementationOnce((_command, _args, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const running = installCli('cursor')
    await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalled())
    expect(cancelCliInstall('cursor')).toBe(true)
    expect(await running).toEqual(expect.objectContaining({ ok: false, cancelled: true }))
  })

  it('records installer output lines for the UI', async () => {
    mocks.exec.mockImplementationOnce(async (_command, _args, options: { onLine: (line: string) => void }) => {
      options.onLine('Downloading Cursor Agent')
    })
    await installCli('cursor')
    const logs = mocks.state.mock.calls.map(([value]) => value.log ?? []).flat()
    expect(logs).toContain('Downloading Cursor Agent')
  })

  it('repairs a present but broken executable and records verification failure', async () => {
    mocks.inspect.mockReset().mockResolvedValue({ installed: false, error: 'Broken executable' })
    expect(await installCli('cursor')).toEqual({ ok: false, error: expect.stringContaining('Broken executable') })
    expect(mocks.exec).toHaveBeenCalledOnce()
    expect(mocks.state).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cursor', phase: 'failed', error: expect.stringContaining('Broken executable') }))
  })

  it('shares duplicate requests, blocks competing installs and allows retry', async () => {
    let finish!: () => void
    mocks.exec.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    const first = installCli('cursor')
    expect(installCli('cursor')).toBe(first)
    expect((await installCli('gemini')).ok).toBe(false)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish()
    expect((await first).ok).toBe(true)
    mocks.inspect.mockResolvedValueOnce({ installed: false })
    expect((await installCli('gemini')).ok).toBe(true)
  })
})

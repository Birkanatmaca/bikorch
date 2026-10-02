import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exec: vi.fn(), candidates: vi.fn() }))
vi.mock('util', () => ({ promisify: () => mocks.exec }))
vi.mock('../adapters', () => ({ resolveSpawnConfigCandidates: mocks.candidates, terminalUserEnv: () => ({ PATH: 'managed' }) }))
import { cliVersionArgs, inspectCli } from '../health'

beforeEach(() => { vi.resetAllMocks(); mocks.candidates.mockReturnValue([{ command: 'agent', args: [] }]) })

describe('CLI health', () => {
  it('keeps a broken executable unavailable', async () => {
    mocks.exec.mockRejectedValue(new Error('missing dependency'))
    expect(await inspectCli('cursor')).toMatchObject({ installed: false, error: expect.stringContaining('repair') })
  })
  it('tries a working launcher after a stale wrapper', async () => {
    mocks.candidates.mockReturnValue([{ command: 'stale', args: [] }, { command: 'node', args: ['agent.js'] }])
    mocks.exec.mockRejectedValueOnce(new Error('broken')).mockResolvedValue({ stdout: 'Agent 1.2.3', stderr: '' })
    expect(await inspectCli('cursor')).toEqual({ installed: true, command: 'node agent.js' })
  })
  it('requires version output and rejects an empty successful command', async () => {
    mocks.exec.mockResolvedValue({ stdout: '', stderr: '' })
    expect((await inspectCli('gemini')).installed).toBe(false)
  })
  it('deduplicates concurrent health checks', async () => {
    let finish!: (value: object) => void
    mocks.exec.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const first = inspectCli('codex')
    expect(inspectCli('codex')).toBe(first)
    finish({ stdout: 'codex-cli 0.100.0', stderr: '' })
    expect((await first).installed).toBe(true)
    expect(mocks.exec).toHaveBeenCalledOnce()
  })
  it('puts Windows version flags inside the cmd command, retaining quoted paths', () => {
    expect(cliVersionArgs({ command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', '"C:\\User Name\\gemini.cmd"'] }))
      .toEqual(['/d', '/s', '/c', '"C:\\User Name\\gemini.cmd" --version'])
  })
})

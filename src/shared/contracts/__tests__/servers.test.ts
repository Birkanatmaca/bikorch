import { describe, expect, it } from 'vitest'
import { normalizeServerDraft, parseRemoteServers, sshCommandArgs, sshTargetLabel } from '../servers'

describe('remote servers', () => {
  it('accepts a named host and hides the default port', () => {
    const result = normalizeServerDraft(
      { name: '  Production  ', user: 'deploy', host: 'app.example.com', port: '' },
      'srv-1'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.server).toEqual({
      id: 'srv-1',
      name: 'Production',
      user: 'deploy',
      host: 'app.example.com',
      port: 22
    })
    expect(sshTargetLabel(result.server)).toBe('deploy@app.example.com')
    expect(sshCommandArgs(result.server)).toEqual(['-p', '22', 'deploy@app.example.com'])
  })

  it('keeps a custom port and rejects shell characters', () => {
    const custom = normalizeServerDraft(
      { name: 'Edge', user: 'root', host: '10.0.0.8', port: '2222' },
      'srv-2'
    )
    expect(custom.ok).toBe(true)
    if (custom.ok) expect(sshTargetLabel(custom.server)).toBe('root@10.0.0.8:2222')

    const injected = normalizeServerDraft(
      { name: 'Bad', user: 'root;rm', host: 'example.com', port: '22' },
      'srv-3'
    )
    expect(injected.ok).toBe(false)
  })

  it('drops invalid saved entries', () => {
    expect(
      parseRemoteServers([
        { id: 'ok', name: 'Lab', user: 'ada', host: 'lab.local', port: 22 },
        { id: 'bad', name: 'Bad', user: 'a b', host: 'lab.local', port: 22 },
        { id: 'ok', name: 'Duplicate', user: 'ada', host: 'lab.local', port: 22 }
      ])
    ).toEqual([{ id: 'ok', name: 'Lab', user: 'ada', host: 'lab.local', port: 22 }])
  })
})

describe('server health parsing', async () => {
  const { parseServerMetrics, healthWarnings } = await import('../server-health')
  it('reads the remote script output', () => {
    const metrics = parseServerMetrics('L 0.50 0.40 0.30\nC 4\nM 8000000000 2000000000\nD 100000000000 95000000000\nU 86400\n')
    expect(metrics).toMatchObject({ load5: 0.4, cpus: 4, memAvailableBytes: 2e9, diskUsedBytes: 95e9, uptimeSeconds: 86400 })
    expect(healthWarnings(metrics!)).toEqual(['Disk is almost full'])
  })
  it('rejects partial output', () => {
    expect(parseServerMetrics('L 1 1 1\nC 2\n')).toBeNull()
  })
})

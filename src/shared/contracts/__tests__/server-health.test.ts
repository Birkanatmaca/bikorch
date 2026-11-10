import { describe, expect, it } from 'vitest'
import { cpuPercentBetween, healthWarnings, parseServerMetrics } from '../server-health'

const OUTPUT = [
  'P1 cpu  1000 0 500 8000 500 0 0 0 0 0',
  'P2 cpu  1300 0 600 8550 550 0 0 0 0 0',
  'N1 1000000 2000000',
  'N2 1524288 2102400',
  'L 0.52 0.40 0.31',
  'C 4',
  'M 8589934592 4294967296',
  'W 2147483648 2147483648',
  'D 107374182400 53687091200',
  'U 864000',
  'H web-01',
  'K 6.8.0-45-generic',
  'O Ubuntu 24.04.1 LTS',
  'Q 213',
  'F 0',
  'X 5',
  'T 524288 3.1 postgres',
  'T 262144 12.0 node',
  ''
].join('\n')

describe('server health parsing', () => {
  it('reads every metric the remote script prints', () => {
    const metrics = parseServerMetrics(OUTPUT)
    expect(metrics).not.toBeNull()
    if (!metrics) return
    expect(metrics.cpuPercent).toBeCloseTo(40)
    expect(metrics.netRxBytesPerSec).toBe(524288)
    expect(metrics.netTxBytesPerSec).toBe(102400)
    expect(metrics.swapTotalBytes).toBe(2147483648)
    expect(metrics.hostname).toBe('web-01')
    expect(metrics.os).toBe('Ubuntu 24.04.1 LTS')
    expect(metrics.kernel).toBe('6.8.0-45-generic')
    expect(metrics.processes).toBe(213)
    expect(metrics.failedUnits).toBe(0)
    expect(metrics.containers).toBe(5)
    expect(metrics.topProcesses).toEqual([
      { name: 'postgres', rssBytes: 524288 * 1024, cpuPercent: 3.1 },
      { name: 'node', rssBytes: 262144 * 1024, cpuPercent: 12 }
    ])
    expect(healthWarnings(metrics)).toEqual([])
  })

  it('still reports the core metrics when optional lines are missing', () => {
    const core = ['L 0.1 0.1 0.1', 'C 2', 'M 100 50', 'D 100 10', 'U 60'].join('\n')
    const metrics = parseServerMetrics(core)
    expect(metrics).toMatchObject({ cpuPercent: null, netRxBytesPerSec: null, containers: null, failedUnits: null, topProcesses: [] })
  })

  it('rejects output without the core metrics', () => {
    expect(parseServerMetrics('Permission denied')).toBeNull()
  })

  it('warns about failed services and heavy swapping', () => {
    const metrics = parseServerMetrics(OUTPUT.replace('F 0', 'F 2').replace('W 2147483648 2147483648', 'W 2147483648 0'))
    expect(metrics && healthWarnings(metrics)).toEqual(['Swapping heavily', '2 services failed'])
  })

  it('ignores an unreadable CPU sample', () => {
    expect(cpuPercentBetween('cpu 1 2 3 4', 'cpu 1 2 3 4')).toBeNull()
    expect(cpuPercentBetween(undefined, 'cpu 1 2 3 4')).toBeNull()
  })
})

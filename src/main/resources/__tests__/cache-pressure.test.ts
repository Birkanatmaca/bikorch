import { describe, expect, it } from 'vitest'
import { assessCachePressure, cacheSignature, parseCacheWarnMb } from '../cache-pressure'

const MB = 1024 * 1024

describe('cache pressure', () => {
  it('snaps the warning slider to the nearest step', () => {
    expect(parseCacheWarnMb(300)).toBe(256)
    expect(parseCacheWarnMb('nope')).toBe(256)
  })

  it('asks only when clearable cache crosses the warning and has not been dismissed', () => {
    const parts = [
      { id: 'browser-http', label: 'Workspace browser HTTP cache', bytes: 300 * MB },
      { id: 'app-code', label: 'App code cache', bytes: 20 * MB }
    ]
    const analysis = assessCachePressure({
      parts,
      warnAtMb: 256,
      dismissedSignature: null,
      recommendation: null,
      collectedAt: 1
    })
    expect(analysis.pressured).toBe(true)
    expect(analysis.dismissed).toBe(false)
    expect(analysis.parts[0]?.label).toBe('Workspace browser HTTP cache')
    expect(analysis.recommendation).toContain('Workspace browser HTTP cache')
    expect(assessCachePressure({
      parts,
      warnAtMb: 256,
      dismissedSignature: analysis.signature,
      recommendation: null,
      collectedAt: 1
    }).dismissed).toBe(true)
  })

  it('asks again after the cache grows into the next bucket', () => {
    const first = cacheSignature(300 * MB, 256)
    const grown = cacheSignature(300 * MB + 64 * MB, 256)
    expect(grown).not.toBe(first)
  })
})

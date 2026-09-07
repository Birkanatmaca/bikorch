import { describe, expect, it } from 'vitest'
import { getVisualizerBarCount, readVisualizerLevels, readVisualizerState } from '../audio-analyser'

describe('audio visualizer levels', () => {
  it('returns a quiet baseline when paused', () => {
    const levels = readVisualizerLevels(false, 0)
    expect(levels).toHaveLength(getVisualizerBarCount())
    expect(levels.every((level) => level > 0 && level < 0.1)).toBe(true)
  })

  it('stays idle while playing if no analyser data is attached', () => {
    const a = readVisualizerState(true)
    const b = readVisualizerState(true)
    expect(a.levels).toHaveLength(getVisualizerBarCount())
    expect(a.levels.every((level) => level <= 0.08)).toBe(true)
    expect(b.levels).toEqual(a.levels)
  })
})

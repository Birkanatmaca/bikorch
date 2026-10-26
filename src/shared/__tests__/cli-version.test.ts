import { describe, expect, it } from 'vitest'
import { parseCliVersion } from '../contracts/cli'

describe('parseCliVersion', () => {
  it.each([
    ['2.0.14 (Claude Code)', '2.0.14'],
    ['codex-cli 0.46.0', '0.46.0'],
    ['0.9.0-nightly.20251001\n', '0.9.0-nightly.20251001'],
    ['2025.09.18-7ae6800', '2025.09.18-7ae6800']
  ])('reads %s', (output, version) => {
    expect(parseCliVersion(output)).toBe(version)
  })

  it('returns undefined without a version', () => {
    expect(parseCliVersion('command not found')).toBeUndefined()
  })
})

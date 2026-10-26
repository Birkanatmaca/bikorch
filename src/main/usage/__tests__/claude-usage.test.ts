import { describe, expect, it } from 'vitest'
import { detectClaudeUsageFailure, parseClaudeUsage } from '../claude-usage'

const TEAM_USAGE = `Settings  Status   Config  Usage  Stats

 Session

 Total cost:            $0.0000
 Total duration (API):  0s

 Current session
 ██████████████████████                                 45% used
 Resets 3:39pm (Europe/Istanbul)

 Current week (Fable)
                                                        0% used
 Resets Oct 20 at 3am (Europe/Istanbul)

 Esc to cancel`

describe('parseClaudeUsage', () => {
  it('reads session and weekly limits from a Team plan /usage screen', () => {
    const usage = parseClaudeUsage(TEAM_USAGE)
    expect(usage?.primary).toMatchObject({
      label: 'Session',
      usedPercent: 45,
      windowDurationMins: 300,
      resetLabel: 'Resets 3:39pm (Europe/Istanbul)'
    })
    expect(usage?.secondary).toMatchObject({
      label: 'Weekly',
      usedPercent: 0,
      windowDurationMins: 10080,
      resetLabel: 'Resets Oct 20 at 3am (Europe/Istanbul)'
    })
  })

  it('reads text positioned with cursor moves instead of newlines', () => {
    const tui = '\u001b[2J\u001b[5;3HCurrent session\u001b[6;3H███\u001b[6;60H12% used\u001b[7;3HResets 5pm\u001b[9;3HCurrent week (all models)\u001b[10;60H30% used\u001b[11;3HResets Oct 21'
    const usage = parseClaudeUsage(tui)
    expect(usage?.primary?.usedPercent).toBe(12)
    expect(usage?.secondary).toMatchObject({ label: 'Weekly', usedPercent: 30 })
    expect(usage?.breakdown[1].label).toBe('Current week (all models)')
  })

  it('waits until the usage numbers have rendered', () => {
    expect(parseClaudeUsage('Settings Status Config Usage\n Loading usage…')).toBeNull()
  })

  it('detects an account that needs to sign in again', () => {
    expect(detectClaudeUsageFailure('Select login method:\n 1. Claude account')).toMatchObject({ status: 'unavailable' })
  })
})

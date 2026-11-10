import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { CliFinishNotice, FINISH_RETRACT_MS, FINISH_SETTLE_MS, MIN_WORK_MS } from '../cli-finish-notice'

function setup() {
  const status: Record<string, PtySessionStatus> = {}
  const notified: string[] = []
  const retracted: string[] = []
  let count = 0
  const notice = new CliFinishNotice({
    notify: (sessionId, outcome) => {
      notified.push(`${sessionId}:${outcome}`)
      count += 1
      return `notice-${count}`
    },
    retract: (_sessionId, noticeId) => retracted.push(noticeId),
    isStillFinished: (sessionId) => status[sessionId] === 'waiting' || status[sessionId] === 'stopped',
    now: () => Date.now()
  })
  const set = (sessionId: string, next: PtySessionStatus): void => {
    const prev = status[sessionId]
    status[sessionId] = next
    notice.onStatus(sessionId, prev, next)
  }
  /** A real stretch of work: busy long enough to be worth announcing. */
  const work = (sessionId: string): void => {
    set(sessionId, 'busy')
    vi.advanceTimersByTime(MIN_WORK_MS)
  }
  return { set, work, notified, retracted, notice }
}

describe('finish notices', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('announces a finish once the CLI has stayed idle', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    expect(cli.notified).toEqual([])
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    expect(cli.notified).toEqual(['a:done'])
  })

  it('stays quiet when an idle-looking moment is followed by more work', () => {
    const cli = setup()
    cli.work('a')
    for (let index = 0; index < 20; index += 1) {
      cli.set('a', 'waiting')
      vi.advanceTimersByTime(150)
      cli.set('a', 'busy')
    }
    vi.advanceTimersByTime(FINISH_SETTLE_MS * 2)
    expect(cli.notified).toEqual([])
  })

  it('announces exits and errors at once', () => {
    const cli = setup()
    cli.set('a', 'busy')
    cli.set('a', 'error')
    cli.work('b')
    cli.set('b', 'stopped')
    expect(cli.notified).toEqual(['a:error', 'b:done'])
  })

  it('does not announce a session that turned busy before the delay ended', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS - 1)
    cli.set('a', 'busy')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    expect(cli.notified).toEqual([])
  })

  it('takes a notice back when the work carries on soon after', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    cli.set('a', 'busy')
    expect(cli.retracted).toEqual(['notice-1'])
  })

  it('keeps a notice once the finish is old news', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    vi.advanceTimersByTime(FINISH_RETRACT_MS + 1)
    cli.set('a', 'busy')
    expect(cli.retracted).toEqual([])
  })

  it('drops a pending finish for a removed session', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    cli.notice.forget('a')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    expect(cli.notified).toEqual([])
  })

  it('ignores short bursts such as slash commands or menu choices', () => {
    const cli = setup()
    cli.set('a', 'busy')
    vi.advanceTimersByTime(MIN_WORK_MS - 500)
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS * 2)
    expect(cli.notified).toEqual([])
  })

  it('announces a turn once even when the CLI keeps flickering busy and idle', () => {
    const cli = setup()
    for (let round = 0; round < 5; round += 1) {
      cli.work('a')
      cli.set('a', 'waiting')
      vi.advanceTimersByTime(FINISH_SETTLE_MS + FINISH_RETRACT_MS + 1)
    }
    expect(cli.notified).toEqual(['a:done'])
  })

  it('announces again after the user sends the next prompt', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    cli.notice.noteInput('a')
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    expect(cli.notified).toEqual(['a:done', 'a:done'])
  })

  it('re-announces at most once after a premature notice is taken back, and keeps that one', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    for (let round = 0; round < 4; round += 1) {
      cli.work('a')
      cli.set('a', 'waiting')
      vi.advanceTimersByTime(FINISH_SETTLE_MS)
    }
    expect(cli.notified).toEqual(['a:done', 'a:done'])
    expect(cli.retracted).toEqual(['notice-1'])
  })

  it('still reports errors outside a turn', () => {
    const cli = setup()
    cli.work('a')
    cli.set('a', 'waiting')
    vi.advanceTimersByTime(FINISH_SETTLE_MS)
    cli.set('a', 'busy')
    cli.set('a', 'error')
    expect(cli.notified).toEqual(['a:done', 'a:error'])
  })
})

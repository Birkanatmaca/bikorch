import type { PtySessionStatus } from '@shared/contracts/pty'
import { didProcessFinish, type ProcessFinishOutcome } from '@renderer/lib/project-activity'

/**
 * Turns busy → idle transitions into "finished" notices without crying wolf.
 *
 * The idle verdict comes from reading terminal output, and a TUI that is still
 * working can look idle for a moment. So a finish counts only when:
 * - the CLI stayed idle for FINISH_SETTLE_MS,
 * - it really worked for at least MIN_WORK_MS of this turn (a slash command,
 *   a menu choice or a one-line reply is not news), and
 * - no notice went out yet in this turn. A turn starts when the user sends the
 *   CLI input; a session's first turn is open from launch. Without this rule a
 *   CLI that flickers between idle and busy announced "finished" again and again.
 *
 * Errors always go out at once. If a session is busy again shortly after its
 * notice, the notice was wrong and is taken back, and the turn may announce
 * once more; that second notice is final, so a flickering CLI cannot loop.
 */

/** How long a CLI must stay idle before it counts as finished. */
export const FINISH_SETTLE_MS = 5000
/** A notice followed by more work within this window is taken back. */
export const FINISH_RETRACT_MS = 20_000
/** Work shorter than this in one turn is not announced. */
export const MIN_WORK_MS = 4000

export interface CliFinishNoticeOptions {
  /** Announce the finish; returns an id to retract it by, or null when nothing was shown. */
  notify: (sessionId: string, outcome: ProcessFinishOutcome) => string | null
  retract: (sessionId: string, noticeId: string) => void
  /** Checked when the settle delay ends: still idle and not asking a question. */
  isStillFinished: (sessionId: string) => boolean
  now?: () => number
}

interface Turn {
  /** A done notice may still go out in this turn. */
  open: boolean
  /** The turn's notice was already taken back once. */
  retracted: boolean
  /** Busy time accumulated in this turn. */
  workedMs: number
  busySince: number | null
}

export class CliFinishNotice {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly recent = new Map<string, { noticeId: string; at: number }>()
  private readonly turns = new Map<string, Turn>()
  private readonly now: () => number

  constructor(private readonly options: CliFinishNoticeOptions) {
    this.now = options.now ?? Date.now
  }

  /** The user sent this CLI input: a new turn may be announced when it ends. */
  noteInput(sessionId: string): void {
    const turn = this.turn(sessionId)
    turn.open = true
    turn.retracted = false
    turn.workedMs = 0
    // Work already under way counts from now, not from the previous turn.
    if (turn.busySince !== null) turn.busySince = this.now()
  }

  onStatus(sessionId: string, prev: PtySessionStatus | undefined, next: PtySessionStatus): void {
    const turn = this.turn(sessionId)
    if (next === 'busy') {
      if (turn.busySince === null) turn.busySince = this.now()
    } else if (turn.busySince !== null) {
      turn.workedMs += this.now() - turn.busySince
      turn.busySince = null
    }

    if (next === 'busy' || next === 'starting') {
      this.cancel(sessionId)
      this.retractRecent(sessionId)
      return
    }
    const outcome = didProcessFinish(prev, next)
    if (!outcome) return
    this.cancel(sessionId)
    if (outcome === 'error') {
      this.announce(sessionId, outcome)
      return
    }
    if (!turn.open || turn.workedMs < MIN_WORK_MS) return
    if (next === 'stopped') {
      this.announce(sessionId, outcome)
      return
    }
    this.pending.set(sessionId, setTimeout(() => {
      this.pending.delete(sessionId)
      if (this.options.isStillFinished(sessionId)) this.announce(sessionId, outcome)
    }, FINISH_SETTLE_MS))
  }

  forget(sessionId: string): void {
    this.cancel(sessionId)
    this.recent.delete(sessionId)
    this.turns.delete(sessionId)
  }

  private turn(sessionId: string): Turn {
    let turn = this.turns.get(sessionId)
    if (!turn) {
      turn = { open: true, retracted: false, workedMs: 0, busySince: null }
      this.turns.set(sessionId, turn)
    }
    return turn
  }

  private announce(sessionId: string, outcome: ProcessFinishOutcome): void {
    const turn = this.turn(sessionId)
    turn.open = false
    const noticeId = this.options.notify(sessionId, outcome)
    if (noticeId) this.recent.set(sessionId, { noticeId, at: this.now() })
    else this.recent.delete(sessionId)
  }

  private retractRecent(sessionId: string): void {
    const recent = this.recent.get(sessionId)
    if (!recent) return
    this.recent.delete(sessionId)
    if (this.now() - recent.at > FINISH_RETRACT_MS) return
    // Only the turn's first notice is taken back, and the real finish may then
    // be announced once more. That second notice stays, so the turn always
    // ends with one notice and a flickering CLI cannot loop.
    const turn = this.turn(sessionId)
    if (turn.retracted) return
    this.options.retract(sessionId, recent.noticeId)
    turn.retracted = true
    turn.open = true
  }

  private cancel(sessionId: string): void {
    const timer = this.pending.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.pending.delete(sessionId)
  }
}

/**
 * Reconstructs the line a user is composing in a CLI TUI from raw xterm `onData` chunks.
 *
 * CLI agents (Claude Code, Codex, Gemini, Cursor Agent…) render their own input box, so the
 * renderer only sees keystrokes. This composer tracks a local buffer that mirrors what the TUI
 * shows, and yields the text when the user presses Enter. It intentionally errs on the side
 * of *not* recording: ambiguous input (history recall, menu answers, slash commands) is dropped.
 */

const MAX_BUFFER = 20_000
const MAX_PENDING_ESCAPE = 64
const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

const YES_NO = new Set(['y', 'n', 'yes', 'no', 'ok', 'q', 'quit', 'exit'])

export function isLikelyPrompt(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 3) return false
  if (!/[\p{L}]/u.test(trimmed)) return false
  if (trimmed.startsWith('/') && !/\s/.test(trimmed)) return false // slash command like /help
  if (YES_NO.has(trimmed.toLowerCase())) return false
  if (/^\d+$/.test(trimmed)) return false
  return true
}

export class PromptComposer {
  private buffer = ''
  private cursor = 0
  private pending = ''
  private inPaste = false
  private historyNavigated = false

  /** Feed a raw data chunk from xterm. Returns any prompts that were submitted. */
  feed(data: string): string[] {
    const submitted: string[] = []
    let input = this.pending + data
    this.pending = ''

    // Whole-chunk heuristics: Enter alone submits; a multi-character chunk containing
    // newlines is a paste (or bracketed paste) and its newlines are content.
    if (input === '\r' || input === '\n' || input === '\r\n') {
      const prompt = this.submit()
      if (prompt) submitted.push(prompt)
      return submitted
    }

    while (input.length > 0) {
      if (this.inPaste) {
        const end = input.indexOf(PASTE_END)
        if (end === -1) {
          // Might be a partial terminator at the tail — keep up to 5 chars pending.
          const keep = partialSuffixLength(input, PASTE_END)
          this.insert(input.slice(0, input.length - keep).replace(/\r\n?/g, '\n'))
          this.pending = input.slice(input.length - keep)
          return submitted
        }
        this.insert(input.slice(0, end).replace(/\r\n?/g, '\n'))
        input = input.slice(end + PASTE_END.length)
        this.inPaste = false
        continue
      }

      const char = input[0]

      if (char === '\u001b') {
        if (input.startsWith(PASTE_START)) {
          this.inPaste = true
          input = input.slice(PASTE_START.length)
          continue
        }
        const sequenceLength = escapeSequenceLength(input)
        if (sequenceLength === null) {
          if (input.length <= MAX_PENDING_ESCAPE) this.pending = input
          return submitted
        }
        this.handleEscape(input.slice(0, sequenceLength))
        input = input.slice(sequenceLength)
        continue
      }

      if (char === '\r' || char === '\n') {
        // Newline inside a larger chunk: treat as content (paste / soft newline).
        this.insert('\n')
        input = input.slice(char === '\r' && input[1] === '\n' ? 2 : 1)
        continue
      }

      if (char === '\u007f' || char === '\b') {
        this.backspace()
      } else if (char === '\u0003' || char === '\u0015') {
        this.reset()
      } else if (char === '\u0017') {
        this.deleteWord()
      } else if (char === '\u0001') {
        this.cursor = 0
      } else if (char === '\u0005') {
        this.cursor = this.buffer.length
      } else if (char === '\u000b') {
        this.buffer = this.buffer.slice(0, this.cursor)
      } else if (char < ' ') {
        // other control characters (tab, ctrl+d, …) are not text
      } else {
        this.insert(char)
      }
      input = input.slice(1)
    }

    return submitted
  }

  /** Current composed text (for diagnostics/tests). */
  peek(): string {
    return this.buffer
  }

  reset(): void {
    this.buffer = ''
    this.cursor = 0
    this.historyNavigated = false
  }

  private submit(): string | null {
    const text = this.buffer.trim()
    const navigated = this.historyNavigated
    this.reset()
    if (navigated && text.length === 0) return null
    return isLikelyPrompt(text) ? text : null
  }

  private insert(text: string): void {
    if (!text) return
    const next = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor)
    this.buffer = next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next
    this.cursor = Math.min(this.buffer.length, this.cursor + text.length)
  }

  private backspace(): void {
    if (this.cursor === 0) return
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor)
    this.cursor -= 1
  }

  private deleteWord(): void {
    if (this.cursor === 0) return
    const head = this.buffer.slice(0, this.cursor).replace(/\S+\s*$/, '')
    this.buffer = head + this.buffer.slice(this.cursor)
    this.cursor = head.length
  }

  private handleEscape(sequence: string): void {
    switch (sequence) {
      case '\u001b[D':
        this.cursor = Math.max(0, this.cursor - 1)
        return
      case '\u001b[C':
        this.cursor = Math.min(this.buffer.length, this.cursor + 1)
        return
      case '\u001b[H':
      case '\u001b[1~':
      case '\u001bOH':
        this.cursor = 0
        return
      case '\u001b[F':
      case '\u001b[4~':
      case '\u001bOF':
        this.cursor = this.buffer.length
        return
      case '\u001b[3~':
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1)
        return
      case '\u001b[A':
      case '\u001b[B':
        // History navigation: the TUI replaces the line with something we cannot see.
        this.historyNavigated = true
        this.buffer = ''
        this.cursor = 0
        return
      case '\u001b\r':
      case '\u001b\n':
      case '\u001b[13;2u':
        this.insert('\n')
        return
      default:
        // Alt+<key>, function keys, mode reports… ignored.
        return
    }
  }
}

function partialSuffixLength(input: string, marker: string): number {
  for (let length = Math.min(marker.length - 1, input.length); length > 0; length -= 1) {
    if (marker.startsWith(input.slice(input.length - length))) return length
  }
  return 0
}

/** Returns the length of the escape sequence at the start of `input`, or null if incomplete. */
function escapeSequenceLength(input: string): number | null {
  if (input.length < 2) return null
  const second = input[1]

  if (second === '[') {
    // CSI: ESC [ params… final byte 0x40–0x7E
    for (let index = 2; index < input.length; index += 1) {
      const code = input.charCodeAt(index)
      if (code >= 0x40 && code <= 0x7e) return index + 1
      if (index - 2 > MAX_PENDING_ESCAPE) return index + 1
    }
    return null
  }
  if (second === ']') {
    // OSC: ESC ] … BEL | ESC \
    const bel = input.indexOf('\u0007', 2)
    const st = input.indexOf('\u001b\\', 2)
    if (bel === -1 && st === -1) return input.length > MAX_PENDING_ESCAPE ? input.length : null
    if (bel === -1) return st + 2
    if (st === -1) return bel + 1
    return Math.min(bel + 1, st + 2)
  }
  if (second === 'O') {
    return input.length >= 3 ? 3 : null
  }
  // ESC + single character (alt+key, alt+enter)
  return 2
}

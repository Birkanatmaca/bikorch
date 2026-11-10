import { looksWorkspaceTrustPrompt } from './cli-permission'

/*
 * Busy/idle detection for agent CLI terminals, shared by the renderer (panel
 * status) and the main process (Manager result collector) so they never drift.
 */
const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]/
const BUSY_WORD_RE = /\b(thinking|generating|searching|analyzing|planning)\b|[✶✻]/i
// Cursor Agent commonly renders its input caret as `›`; keep the prompt
// markers broad enough to recognize a ready CLI without treating normal text
// as idle because the marker must still be the final non-whitespace character.
const IDLE_PROMPT_RE = /(?:^|\n)\s*(?:>|❯|▶|▸|➤|➜|›|→)\s*$/
const CURSOR_WELCOME_RE = /(?:^|\n)\s*(?:›|→)\s*(?:plan,\s*search,\s*build anything|ask anything)\s*$/im
const IDLE_BOX_RE = /(?:ask|message|prompt)\s*(?:the\s+)?(?:agent|model|assistant)?\s*$/i
// Modern TUIs (Claude Code 2.x, Codex) keep a status line under the input box, so
// the prompt marker is no longer the last character. While working they show
// "esc to interrupt"; at rest they show input hints. The later of the two wins,
// because a stream tail can still hold the previous state's text.
// Claude Code 2.x also names the work with a gerund and an ellipsis ("✽ Zigzagging…").
const BUSY_HINT_RE = /esc\s*to\s*interrupt|ctrl\+c\s*to\s*interrupt|esc\s*to\s*cancel,\s*\d+s|\b[A-Z][a-z]{2,}ing…/gi
// When a turn ends Claude Code leaves a past-tense summary behind its spinner
// glyph ("✻ Cogitated for 3s · done"); Codex draws it inside a rule ("─ Worked for 1m 05s ─").
// The glyph is required: tool output such as "⎿ Waited for 5s" appears mid-turn.
// "Thought for 3s" is excluded: it marks a finished thinking block mid-turn.
const IDLE_HINT_RE = /shift\+tab\s*to\s*cycle|\?\s*for\s*shortcuts|for\s*shortcuts\b|\bctrl\+j\s*for\s*newline|type\s*your\s*message|[·✢✳✶✻✽*─]\s*(?!thought\b)[A-Z][a-z]{2,}(?:ed|t)\s+for\s+\d+(?:h|m|s)\b/gi
// Claude Code's effort label ("◐ medium · /effort") reuses spinner glyphs.
const EFFORT_LABEL_RE = /[◐◓◑◒]\s*(?:low|medium|high|xhigh|max)\b/gi

function lastMatchIndex(text: string, pattern: RegExp): number {
  let index = -1
  for (const match of text.matchAll(pattern)) index = match.index ?? index
  return index
}


/**
 * Classifies already ANSI-stripped terminal text. A stream tail is ordered by
 * time, so the newest hint wins. A rendered screen is ordered by layout (the
 * "esc to interrupt" line sits above the input hints), so any busy hint on it
 * means the CLI is working right now.
 */
export function inferCliActivityFromText(text: string, options: { screen?: boolean } = {}): 'waiting' | 'busy' | null {
  const tail = text.replace(/\r/g, '').slice(-1200)
  if (!tail.trim()) return null
  if (looksWorkspaceTrustPrompt(tail)) return null
  // A prompt at the end is definitive. The same retained terminal tail often still
  // contains a spinner or a word such as "thinking" from the completed response.
  if (options.screen && lastMatchIndex(tail, BUSY_HINT_RE) >= 0) return 'busy'
  if (IDLE_PROMPT_RE.test(tail) || CURSOR_WELCOME_RE.test(tail) || IDLE_BOX_RE.test(tail)) return 'waiting'
  const busyAt = lastMatchIndex(tail, BUSY_HINT_RE)
  const idleAt = lastMatchIndex(tail, IDLE_HINT_RE)
  if (options.screen && busyAt >= 0) return 'busy'
  if (busyAt >= 0 || idleAt >= 0) return busyAt > idleAt ? 'busy' : 'waiting'
  const withoutEffort = tail.replace(EFFORT_LABEL_RE, '')
  if (SPINNER_RE.test(withoutEffort) || BUSY_WORD_RE.test(withoutEffort)) return 'busy'
  return null
}

// The spinner line of a working TUI: a glyph, a label, then the interrupt hint
// inside its status group: "✽ Zigzagging… (12s · esc to interrupt)",
// "• Working (3s • esc to interrupt)", "⠏ Thinking... (esc to cancel, 3s)".
const SPINNER_LINE_RE = /^(?!.*[`'"])\s*[^\w\s]\s*\S.{0,120}?[(·•][^\n]{0,60}?\b(?:esc|ctrl\+c)\s*to\s*(?:interrupt|cancel)\b/i
// The spinner sits just above the input box, its footer and an optional to-do list.
const SPINNER_SEARCH_ROWS = 24

/**
 * True when a rendered screen shows a TUI's spinner line, the one sign of work
 * that output redraws cannot fake: input hints are redrawn after it in the
 * stream, but on screen it stays until the turn ends. Only the bottom rows are
 * read, and only a line shaped like a spinner counts, so a transcript that
 * merely mentions "esc to interrupt" does not keep a session busy.
 */
export function screenShowsWorking(screen: string): boolean {
  const rows = screen.replace(/\r/g, '').split('\n')
  return rows.slice(-SPINNER_SEARCH_ROWS).some((row) => SPINNER_LINE_RE.test(row))
}

// A CLI asking the user to choose: a question, then a selected option such as
// "❯ 1. Yes" (Claude Code, Codex, Gemini) or a "(y/n)" style answer.
const ASK_QUESTION_RE = /\b(?:do\s*you\s*want|would\s*you\s*like|allow|approve|proceed|continue|trust|run\s*this|apply\s*(?:this|these)|make\s*this\s*edit|overwrite|create\s*this\s*file)[^\n?]{0,90}\?/gi
const ASK_OPTION_RE = /(?:^|\n)[ \t│|]*(?:❯|›|▶|▸|●|>)\s*(?:\d+[.)]\s*)?(?:yes|allow|approve|proceed|continue|trust|accept|run)\b/gi
const ASK_YES_NO_RE = /\((?:y\/n|yes\/no)\)|\[(?:y\/n)\]/gi
// Claude Code's choice dialogs end with this footer.
const ASK_FOOTER_RE = /enter\s*to\s*confirm/gi

/**
 * True when the end of an ANSI-stripped stream shows a CLI waiting for the
 * user to approve or answer something. A busy or idle hint printed after the
 * question means it was already answered.
 */
export function inferCliAskingFromText(text: string): boolean {
  const tail = text.replace(/\r/g, '').slice(-900)
  if (!tail.trim()) return false
  const yesNoAt = lastMatchIndex(tail, ASK_YES_NO_RE)
  const optionAt = lastMatchIndex(tail, ASK_OPTION_RE)
  const questionAt = lastMatchIndex(tail, ASK_QUESTION_RE)
  const footerAt = lastMatchIndex(tail, ASK_FOOTER_RE)
  let askedAt: number
  if (yesNoAt >= 0) askedAt = yesNoAt
  else if (footerAt >= 0 && optionAt >= 0 && optionAt < footerAt) askedAt = optionAt
  else if (optionAt >= 0 && questionAt >= 0 && questionAt < optionAt) askedAt = questionAt
  else if (looksWorkspaceTrustPrompt(tail)) return true
  else return false
  const movedOnAt = Math.max(lastMatchIndex(tail, BUSY_HINT_RE), lastMatchIndex(tail, IDLE_HINT_RE))
  return movedOnAt < askedAt
}

/** The CLI is working or back at its input: any earlier question was answered. */
export function cliMovedOnFromText(text: string): boolean {
  return lastMatchIndex(text, BUSY_HINT_RE) >= 0 || lastMatchIndex(text, IDLE_HINT_RE) >= 0
}

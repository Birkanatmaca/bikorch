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
const BUSY_HINT_RE = /esc to interrupt|ctrl\+c to interrupt|esc to cancel,\s*\d+s/gi
const IDLE_HINT_RE = /shift\+tab to cycle|\? for shortcuts|for shortcuts\b|\bctrl\+j for newline|type your message/gi
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

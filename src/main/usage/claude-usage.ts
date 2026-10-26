import type { CliUsageBreakdown, CliUsageWindow } from '@shared/contracts/usage'

type ClaudeWindow = CliUsageWindow & { fullLabel: string }

export interface ClaudeUsageSnapshot {
  primary?: CliUsageWindow
  secondary?: CliUsageWindow
  breakdown: CliUsageBreakdown[]
}

function stripControl(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '\n')
    .replace(/\u001b[@-_]/g, '')
    .replace(/\r/g, '\n')
}

/**
 * Reads the Usage tab of Claude Code's `/usage` (also on Team plans):
 *
 *   Current session
 *   ███████░░░░░░░░░░   45% used
 *   Resets 3:39pm (Europe/Istanbul)
 *
 *   Current week (Fable)
 *   ░░░░░░░░░░░░░░░░░   0% used
 *   Resets Oct 20 at 3am (Europe/Istanbul)
 *
 * Section titles vary by plan ("Current week (all models)", "(Opus)", …), so any
 * "Current …" heading followed by "N% used" counts. Cursor moves are turned into
 * line breaks because the TUI positions text instead of printing newlines.
 */
export function parseClaudeUsage(output: string): ClaudeUsageSnapshot | null {
  const text = stripControl(output)
  if (!/Current session/i.test(text) || !/\d+(?:\.\d+)?%\s*used/i.test(text)) return null
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const windows: ClaudeWindow[] = []
  const seen = new Set<string>()

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(Current (?:session|week)(?: \([^)]*\))?)/i.exec(lines[index])?.[1]
    if (!heading || seen.has(heading.toLowerCase())) continue
    const nearby = lines.slice(index, index + 5).join(' ')
    const used = /(\d+(?:\.\d+)?)%\s*used/i.exec(nearby)
    if (!used) continue
    seen.add(heading.toLowerCase())
    const reset = /Resets\s+(.+?)(?=\s+Current |\s+Esc to|\s+Extra usage|$)/i.exec(nearby)?.[1]?.trim() ?? null
    const session = /session/i.test(heading)
    const fullLabel = heading.replace(/\s+/g, ' ')
    windows.push({
      // Short enough for the account card ring; the full heading stays in the breakdown.
      label: session ? 'Session' : 'Weekly',
      fullLabel,
      usedPercent: Math.min(100, Math.max(0, Number(used[1]))),
      windowDurationMins: session ? 300 : 10080,
      resetsAt: null,
      resetLabel: reset ? `Resets ${reset}` : null
    })
  }

  if (windows.length === 0) return null
  // Show the tightest limit first so the card reflects what will block work soonest.
  const sessionWindow = windows.find((window) => window.windowDurationMins === 300)
  const weekWindows = windows.filter((window) => window !== sessionWindow)
  const ordered = sessionWindow ? [sessionWindow, ...weekWindows] : weekWindows
  const strip = (window: ClaudeWindow | undefined): CliUsageWindow | undefined => {
    if (!window) return undefined
    const { fullLabel: _fullLabel, ...rest } = window
    return rest
  }
  return {
    primary: strip(ordered[0]),
    secondary: strip(ordered[1]),
    breakdown: ordered.map((window) => ({
      label: window.fullLabel,
      value: `${window.usedPercent}% used${window.resetLabel ? ` · ${window.resetLabel}` : ''}`,
      usedPercent: window.usedPercent
    }))
  }
}

export function detectClaudeUsageFailure(output: string): { status: 'unavailable'; detail: string } | null {
  const text = stripControl(output)
  if (/Select login method|Please run \/login|Invalid API key|not logged in|OAuth token (?:has )?expired/i.test(text)) {
    return { status: 'unavailable', detail: 'Claude Code needs you to sign in again' }
  }
  if (/only available for subscription plans|\/usage is not available/i.test(text)) {
    return { status: 'unavailable', detail: 'This Claude account has no subscription usage limits to show' }
  }
  return null
}

/** Claude Code asks once per folder whether to trust it. */
export function looksClaudeTrustPrompt(output: string): boolean {
  return /Do you trust the files in this folder|Is this a project you created or one you trust|trust this folder/i.test(stripControl(output))
}

export function looksClaudeReady(output: string): boolean {
  const text = stripControl(output)
  return /for shortcuts|shift\+tab to cycle|\/model to/i.test(text) || /(?:^|\n)\s*[❯>]\s*(?:\n|$)/.test(text)
}

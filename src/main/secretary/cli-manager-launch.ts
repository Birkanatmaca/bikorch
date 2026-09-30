import type { CliUsageKind } from '@shared/contracts/usage'

const SUPPORTED: readonly CliUsageKind[] = ['cursor', 'claude', 'gemini', 'codex', 'antigravity']

export function cliManagerSupportsKind(kind: CliUsageKind | null): boolean {
  return kind !== null && SUPPORTED.includes(kind)
}

/** Stable id for Manager's own CLI chat. Coding-agent panel ids are never used. */
export function managerCliSessionId(kind: CliUsageKind, accountId: string): string {
  return `manager:${kind}:${accountId}`
}

export interface ManagerCliCommand {
  command: string
  args: string[]
}

export function managerCliPrintCommand(input: {
  kind: CliUsageKind
  command: string
  baseArgs: string[]
  workspace: string
  model: string | null
  chatId: string | null
  prompt: string
}): ManagerCliCommand {
  const args = [...input.baseArgs]
  const model = input.model?.trim() || null
  if (input.kind === 'cursor') {
    args.push('-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', input.workspace)
    if (model) args.push('--model', model)
    if (input.chatId) args.push('--resume', input.chatId)
  } else if (input.kind === 'claude') {
    args.push('-p', '--output-format', 'json', '--permission-mode', 'plan')
    if (model) args.push('--model', model)
  } else if (input.kind === 'gemini') {
    args.push('--approval-mode', 'plan', '--output-format', 'json')
    if (model) args.push('--model', model)
    args.push('-p', input.prompt)
    return { command: input.command, args }
  } else if (input.kind === 'codex') {
    args.push('exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', input.workspace)
    if (model) args.push('--model', model)
  } else {
    args.push('--print', '--output-format', 'json', '--mode', 'plan', '--sandbox')
    if (model) args.push('--model', model)
  }
  args.push(input.prompt)
  return { command: input.command, args }
}

export function managerCliOpenCommand(input: {
  kind: CliUsageKind
  command: string
  baseArgs: string[]
}): ManagerCliCommand | null {
  if (input.kind !== 'cursor') return null
  return { command: input.command, args: [...input.baseArgs, 'create-chat'] }
}

export function readCursorChatId(stdout: string): string | null {
  const uuid = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  if (uuid) return uuid[0]
  const token = stdout.split(/\s+/).map((part) => part.trim()).find((part) => /^[A-Za-z0-9_-]{8,80}$/.test(part))
  return token ?? null
}

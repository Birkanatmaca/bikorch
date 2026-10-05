import { describe, expect, it } from 'vitest'
import { SECRETARY_CHAT_RESPONSE_FORMAT } from '../response-schema'
import {
  managerCliPrintCommand,
  managerCliSessionId,
  readCursorChatId
} from '../cli-manager-launch'
import { normalizeManagerCliOutput } from '../cli-manager-output'

const workspace = '/Users/birkan-is/Library/Application Support/Bikorch/manager-cli/cursor/account-1'
const project = '/Users/birkan-is/bikorch'

describe('dedicated Manager CLI session', () => {
  it('keeps the Manager chat id separate from coding sessions', () => {
    expect(managerCliSessionId('cursor', 'account-1')).toBe('manager:cursor:account-1')
    expect(readCursorChatId('created chat 11111111-1111-4111-8111-111111111111\n')).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('asks Cursor in read-only mode inside the Manager workspace', () => {
    const command = managerCliPrintCommand({
      kind: 'cursor',
      command: 'agent',
      baseArgs: [],
      workspace,
      model: null,
      chatId: '11111111-1111-4111-8111-111111111111',
      prompt: 'Reply with JSON'
    })
    expect(command.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--mode', 'ask', '--workspace', workspace, '--resume', '11111111-1111-4111-8111-111111111111']))
    expect(command.args).not.toContain('Reply with JSON')
    expect(command.stdin).toBe('Reply with JSON')
    expect(command.args).not.toContain('--force')
    expect(command.args).not.toContain('--yolo')
    expect(command.args.join(' ')).not.toContain(project)
  })

  it('keeps a large project prompt off the command line', () => {
    const prompt = `project context ${'x'.repeat(40_000)}`
    const command = managerCliPrintCommand({
      kind: 'cursor',
      command: 'agent',
      baseArgs: [],
      workspace,
      model: null,
      chatId: null,
      prompt
    })
    expect(command.stdin).toBe(prompt)
    expect(command.args.join('\n')).not.toContain(prompt)
  })

  it('normalizes CLI stdout into the Manager response contract', () => {
    const wrapped = JSON.stringify({
      result: JSON.stringify({ reply: 'Use the smaller plan.', actions: [], plan: null })
    })
    const text = normalizeManagerCliOutput(`\u001b[32m${wrapped}\u001b[0m`, SECRETARY_CHAT_RESPONSE_FORMAT)
    const parsed = JSON.parse(text) as { reply: string; actions: unknown[]; plan: null }
    expect(parsed.reply).toBe('Use the smaller plan.')
    expect(parsed.actions).toEqual([])
    expect(parsed.plan).toBeNull()
  })

  it('does not invent a reply when the CLI returns nothing', () => {
    expect(() => normalizeManagerCliOutput('   ', SECRETARY_CHAT_RESPONSE_FORMAT)).toThrow(/no structured result/i)
  })
})

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, powerMonitor: {} }))
vi.mock('../../persistence/database', () => ({ listPersistedProjectFolders: () => [] }))

const { summarizeTranscript, localDate } = await import('../claude-activity')
const { parseTopProcesses, parseVmStat } = await import('../system-metrics')

describe('summarizeTranscript', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('counts typed prompts and the last usage of each streamed message', async () => {
    dir = mkdtempSync(join(tmpdir(), 'claude-activity-'))
    const at = '2026-11-05T09:00:00.000Z'
    const lines = [
      { type: 'user', timestamp: at, message: { role: 'user', content: 'fix the login bug' } },
      { type: 'user', timestamp: at, message: { role: 'user', content: '<command-name>/usage</command-name>' } },
      { type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'user', timestamp: at, isMeta: true, message: { role: 'user', content: 'meta' } },
      { type: 'assistant', timestamp: at, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 5 } } },
      { type: 'assistant', timestamp: at, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 100 } } },
      { type: 'api-request-blob', timestamp: at, data: 'x'.repeat(1000) }
    ]
    const file = join(dir, 'session.jsonl')
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'))
    const summary = await summarizeTranscript(file)
    expect(summary.days[localDate(at)!]).toEqual({ prompts: 1, inputTokens: 3, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 0 })
    expect(summary.models).toEqual({ 'claude-opus-5-5': 40 })
  })
})

describe('system metrics parsing', () => {
  it('reads ps output and skips ps itself', () => {
    const output = '  PID  %CPU    RSS COMM\n  10  54.2  2048 mdworker_shared\n  11   0.1  100 ps\n  12  12.0  4096 WindowServer\n'
    expect(parseTopProcesses(output)).toEqual([
      { pid: 10, cpuPercent: 54.2, memoryBytes: 2048 * 1024, name: 'mdworker_shared' },
      { pid: 12, cpuPercent: 12, memoryBytes: 4096 * 1024, name: 'WindowServer' }
    ])
  })
  it('treats inactive and purgeable pages as available memory', () => {
    const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\nPages inactive: 50.\nPages speculative: 10.\nPages purgeable: 40.\n'
    expect(parseVmStat(vm, 16384 * 1000)).toBe(16384 * 800)
  })
})

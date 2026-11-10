import { describe, expect, it } from 'vitest'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { ScreenMirror } from '../screen-mirror'

function writeAll(terminal: HeadlessTerminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function screenText(terminal: HeadlessTerminal): string[] {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let y = 0; y < terminal.rows; y++) {
    lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '')
  }
  return lines
}

async function replayInto(data: string, cols: number, rows: number): Promise<HeadlessTerminal> {
  const terminal = new HeadlessTerminal({ cols, rows, scrollback: 2000, allowProposedApi: true })
  await writeAll(terminal, data)
  return terminal
}

describe('ScreenMirror', () => {
  it('rebuilds a full-screen TUI frame exactly, including the alternate buffer and cursor', async () => {
    const mirror = new ScreenMirror(40, 8)
    for (let i = 0; i < 30; i++) mirror.write(`shell line ${i}\r\n`)
    // Enter the alternate screen and paint a framed UI with absolute cursor moves.
    mirror.write('\x1b[?1049h\x1b[2J\x1b[H')
    mirror.write('\x1b[1;1H╭──────── agent ────────╮')
    mirror.write('\x1b[3;3H\x1b[32mThinking…\x1b[0m')
    mirror.write('\x1b[5;3HTool: edit file')
    // Overwrite part of an earlier line, as a spinner redraw would.
    mirror.write('\x1b[3;3HWorking… ')
    mirror.write('\x1b[8;1H> type here\x1b[8;8H')

    const { data, seq } = await mirror.snapshot()
    expect(seq).toBe(36)

    const restored = await replayInto(data, 40, 8)
    expect(restored.buffer.active.type).toBe('alternate')
    const source = new HeadlessTerminal({ cols: 40, rows: 8, scrollback: 2000, allowProposedApi: true })
    await writeAll(source, Array.from({ length: 30 }, (_, i) => `shell line ${i}\r\n`).join('') +
      '\x1b[?1049h\x1b[2J\x1b[H\x1b[1;1H╭──────── agent ────────╮\x1b[3;3H\x1b[32mThinking…\x1b[0m' +
      '\x1b[5;3HTool: edit file\x1b[3;3HWorking… \x1b[8;1H> type here\x1b[8;8H')
    expect(screenText(restored)).toEqual(screenText(source))
    expect(restored.buffer.active.cursorX).toBe(source.buffer.active.cursorX)
    expect(restored.buffer.active.cursorY).toBe(source.buffer.active.cursorY)

    mirror.dispose()
  })

  it('serializes at the current grid after a resize', async () => {
    const mirror = new ScreenMirror(30, 6)
    mirror.write('hello\r\nworld\r\n')
    mirror.resize(50, 10)
    const { data } = await mirror.snapshot()
    const restored = await replayInto(data, 50, 10)
    const text = screenText(restored).join('\n')
    expect(text).toContain('hello')
    expect(text).toContain('world')
    mirror.dispose()
  })

  it('counts every chunk so reattach can drop output the snapshot already holds', async () => {
    const mirror = new ScreenMirror(30, 6)
    expect(mirror.write('a')).toBe(1)
    expect(mirror.write('b')).toBe(2)
    const pending = mirror.snapshot()
    // Arrives while the snapshot is being taken: must not be part of it.
    expect(mirror.write('c')).toBe(3)
    const { data, seq } = await pending
    expect(seq).toBe(2)
    const restored = await replayInto(data, 30, 6)
    expect(screenText(restored)[0]).toBe('ab')
    mirror.dispose()
  })

  it('returns an empty screen once disposed', async () => {
    const mirror = new ScreenMirror(30, 6)
    mirror.write('x')
    mirror.dispose()
    await expect(mirror.snapshot()).resolves.toEqual({ data: '', seq: 1 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { screenShowsWorking } from '@shared/cli-activity-detect'
import { CliActivityTracker, SCREEN_CLASSIFY_MS, inferCliActivity, streamText } from '../cli-activity'

// Shapes taken from a real Claude Code 2.x session: words placed with cursor
// moves (ESC[nG / ESC[nC), the window title set through OSC with spinner glyphs.
const ESC = '\u001b'
const col = (n: number): string => `${ESC}[${n}G`
const title = (text: string): string => `${ESC}]0;${text}\u0007`

const working = `${title('✳ Bash touch a.txt')}${ESC}[38;2;215;119;87m✽ Zigzagging…${ESC}[39m · esc${col(8)}to${col(11)}interrupt`
const permission = [
  `Bash command\r${ESC}[1C${ESC}[1B`,
  `touch${col(8)}made-by-bash.txt\r${ESC}[1B`,
  `Do${col(5)}you${col(9)}want${col(14)}to${col(17)}proceed?\r${ESC}[1C${ESC}[1B`,
  `❯${col(4)}1. Yes\r${ESC}[3C${ESC}[1B2. Yes,${col(12)}and${col(16)}don’t${col(22)}ask${col(26)}again\r${ESC}[3C${ESC}[1B3. No\r`,
  `${ESC}[1C${ESC}[2BEsc to cancel · Tab to amend`
].join('')
const blink = `${ESC}[H\r${ESC}[8B⏺${ESC}[40;1H${ESC}[H\r${ESC}[8B ${ESC}[40;1H`
const finished = `✻ Cogitated for 3s · done 2:48 PM\r\r❯ \r${ESC}[2C  cat a.txt`
const interrupted = 'Interrupted · What should Claude do instead?\r✻ Crunched for 1s · done 2:52 PM\r❯ \r  ⏸ manual mode on · ? for shortcuts'

function tracker(): { feed: (text: string) => void; status: () => PtySessionStatus | undefined; asking: () => boolean } {
  let status: PtySessionStatus | undefined = 'waiting'
  let asking = false
  const instance = new CliActivityTracker({ apply: (next) => { status = next }, getStatus: () => status })
  return {
    feed: (text) => {
      instance.feedText(text)
      asking = instance.isAsking()
      instance.classify()
    },
    status: () => status,
    asking: () => asking
  }
}

describe('terminal stream text', () => {
  it('turns cursor moves into spaces and drops window titles', () => {
    expect(streamText(`Do${col(5)}you${ESC}[1Cwant`)).toBe('Do you want')
    expect(streamText(`${title('✳ Working')}ok`)).toBe('ok')
    expect(streamText('❯ ')).toBe('❯ ')
  })
})

describe('CLI activity from a Claude Code stream', () => {
  it('works, then returns to idle when the turn ends', () => {
    const cli = tracker()
    cli.feed(working)
    expect(cli.status()).toBe('busy')
    cli.feed(finished)
    expect(cli.status()).toBe('waiting')
    expect(cli.asking()).toBe(false)
  })

  it('asks for permission and keeps asking while the prompt sits on screen', () => {
    const cli = tracker()
    cli.feed(working)
    cli.feed(permission)
    expect(cli.asking()).toBe(true)
    for (let index = 0; index < 120; index += 1) cli.feed(blink)
    expect(cli.asking()).toBe(true)
  })

  it('stops asking once the question is answered', () => {
    const cli = tracker()
    cli.feed(permission)
    expect(cli.asking()).toBe(true)
    cli.feed(working)
    expect(cli.asking()).toBe(false)
    cli.feed(permission)
    cli.feed(interrupted)
    expect(cli.asking()).toBe(false)
    expect(cli.status()).toBe('waiting')
  })
})

describe('CLI activity read from a rendered screen', () => {
  // Claude Code draws the spinner, the input box and its footer, then redraws
  // only the lines that change: here, the footer after the spinner.
  const frame = `⏺ Bash(sleep 5)\r\n✽ Zigzagging… (3s · esc to interrupt)\r\n❯ \r\n  ⏵⏵ accept edits on (shift+tab to cycle)`
  const footerRedraw = `\r${ESC}[2K  ⏵⏵ accept edits on (shift+tab to cycle)`
  const toolOutput = `${ESC}[3A\r${ESC}[2K  ⎿ Waited for 5s${ESC}[3B\r`
  const turnEnds = `${ESC}[2A\r${ESC}[2K✻ Cogitated for 3s · done${ESC}[2B\r${ESC}[2K  ⏵⏵ accept edits on (shift+tab to cycle)`

  function screenTracker() {
    let status: PtySessionStatus | undefined = 'waiting'
    const instance = new CliActivityTracker({ apply: (next) => { status = next }, getStatus: () => status, screen: true })
    return { instance, status: () => status }
  }

  it('stays busy while the spinner is on screen, whatever the stream ends with', async () => {
    const cli = screenTracker()
    cli.instance.feedText(frame)
    await vi.waitFor(() => expect(cli.status()).toBe('busy'))
    cli.instance.feedText(footerRedraw)
    cli.instance.feedText(toolOutput)
    // The stream alone would call this idle; the screen still shows the spinner.
    expect(inferCliActivity(frame + footerRedraw)).toBe('waiting')
    await new Promise((resolve) => setTimeout(resolve, SCREEN_CLASSIFY_MS * 3))
    expect(cli.status()).toBe('busy')
    cli.instance.dispose()
  })

  it('goes idle once the spinner line is gone', async () => {
    const cli = screenTracker()
    cli.instance.feedText(frame)
    await vi.waitFor(() => expect(cli.status()).toBe('busy'))
    cli.instance.feedText(turnEnds)
    await vi.waitFor(() => expect(cli.status()).toBe('waiting'))
    cli.instance.dispose()
  })
})

describe('spotting a spinner line on screen', () => {
  it('knows the spinner lines of Claude Code, Codex and Gemini', () => {
    expect(screenShowsWorking('✽ Zigzagging… (12s · ↓ 1.2k tokens · esc to interrupt)\n❯ \n  ⏵⏵ auto mode on')).toBe(true)
    expect(screenShowsWorking('• Working (3s • esc to interrupt)\n›')).toBe(true)
    expect(screenShowsWorking('⠏ Thinking... (esc to cancel, 3s)\n>')).toBe(true)
  })

  it('ignores a transcript that only talks about the hint', () => {
    expect(screenShowsWorking('The status line (esc to interrupt) shows while it works.\n❯ ')).toBe(false)
    expect(screenShowsWorking('- matches `(esc to interrupt)` in the stream\n❯ ')).toBe(false)
    const old = '✽ Zigzagging… (3s · esc to interrupt)\n' + 'line\n'.repeat(40) + '❯ '
    expect(screenShowsWorking(old)).toBe(false)
  })
})

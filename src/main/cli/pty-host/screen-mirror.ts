import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

/** Scrollback kept by the mirror and sent back on reattach. */
export const MIRROR_SCROLLBACK = 1500

export interface ScreenSnapshot {
  /** ANSI that rebuilds the screen, scrollback, modes and cursor in a blank terminal. */
  data: string
  /** Number of output chunks contained in `data`; later chunks carry a higher seq. */
  seq: number
}

/**
 * A headless copy of a PTY's screen. Reattaching a view used to replay a raw
 * byte tail cut at an arbitrary point and recorded at other grid sizes, so
 * full-screen TUIs came back garbled. The mirror parses the same bytes and can
 * hand back the screen as it actually is now, at the current size.
 */
export class ScreenMirror {
  private readonly terminal: HeadlessTerminal
  private readonly serializer = new SerializeAddon()
  private chunks = 0
  private disposed = false

  constructor(cols: number, rows: number) {
    this.terminal = new HeadlessTerminal({
      cols,
      rows,
      scrollback: MIRROR_SCROLLBACK,
      allowProposedApi: true
    })
    // The addon is typed against @xterm/xterm but only touches the shared buffer API.
    this.terminal.loadAddon(this.serializer as unknown as Parameters<HeadlessTerminal['loadAddon']>[0])
  }

  get seq(): number {
    return this.chunks
  }

  /** Feed one output chunk; returns its sequence number. */
  write(data: string): number {
    this.chunks += 1
    if (!this.disposed) this.terminal.write(data)
    return this.chunks
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return
    if (this.terminal.cols === cols && this.terminal.rows === rows) return
    this.terminal.resize(cols, rows)
  }

  /** Waits for every chunk written so far to be parsed, then serializes exactly that state. */
  snapshot(): Promise<ScreenSnapshot> {
    const seq = this.chunks
    if (this.disposed) return Promise.resolve({ data: '', seq })
    return new Promise((resolve) => {
      this.terminal.write('', () => {
        if (this.disposed) {
          resolve({ data: '', seq })
          return
        }
        try {
          resolve({ data: this.serializer.serialize({ scrollback: MIRROR_SCROLLBACK }), seq })
        } catch {
          resolve({ data: '', seq })
        }
      })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.terminal.dispose()
  }
}

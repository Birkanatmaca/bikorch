/** Keeps keystrokes in order while a CLI PTY starts and while a submit awaits context. */
export class TerminalInputQueue {
  private state: 'starting' | 'ready' | 'closed' = 'starting'
  private pending: string[] = []
  private pendingLength = 0
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly write: (data: string) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly maxPendingLength = 16_000
  ) {}

  offer(data: string): boolean {
    if (this.state === 'closed') return false
    if (this.state === 'starting') {
      if (this.pendingLength + data.length > this.maxPendingLength) return false
      this.pending.push(data)
      this.pendingLength += data.length
      return true
    }
    this.enqueue(data)
    return true
  }

  ready(): void {
    if (this.state !== 'starting') return
    this.state = 'ready'
    for (const data of this.pending) this.enqueue(data)
    this.pending = []
    this.pendingLength = 0
  }

  close(): void {
    this.state = 'closed'
    this.pending = []
    this.pendingLength = 0
  }

  private enqueue(data: string): void {
    this.tail = this.tail.then(async () => {
      if (this.state === 'ready') await this.write(data)
    }).catch(this.onError)
  }
}

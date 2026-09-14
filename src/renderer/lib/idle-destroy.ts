/**
 * Generation-token idle controller. `stayActive` cancels a pending destroy so an
 * attached WebChat/browser guest cannot be torn down by a stale timer.
 */
export class IdleDestroyController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private token = 0

  constructor(
    private readonly getIdleMs: () => number,
    private readonly onIdle: () => void
  ) {}

  stayActive(): void {
    this.token += 1
    this.clearTimer()
  }

  beginIdle(): void {
    this.clearTimer()
    const token = (this.token += 1)
    const ms = this.getIdleMs()
    if (!Number.isFinite(ms) || ms <= 0) return
    this.timer = setTimeout(() => {
      if (token !== this.token) return
      this.timer = null
      this.onIdle()
    }, ms)
  }

  dispose(): void {
    this.token += 1
    this.clearTimer()
  }

  get pending(): boolean {
    return this.timer !== null
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

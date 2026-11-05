import type { WebContents } from 'electron'
import { parseKey, parsePointer, SIMULATOR_IPC, type SimulatorFeed, type SimulatorStatus } from '@shared/contracts/simulator'
import { sendSimulatorInput, startInputBridge, startWindowStream, stopInputBridge, type StreamEvent } from './bridge'
import { SimulatorUnavailable } from './devices'
import { bootSimulator, captureSimulatorScreen, ensureIphone, openSimulatorApp, resolveSimctl } from './simctl'

interface ActiveDevice {
  udid: string
  name: string
}

class SimulatorSession {
  private refs = 0
  private epoch = 0
  private running = false
  /** True while ScreenCaptureKit streams the window; screenshots are only a fallback. */
  private streaming = false
  private sender: WebContents | null = null
  private device: ActiveDevice | null = null
  private simctl: string | null = null
  private mode: SimulatorFeed | null = null
  private inputReady: boolean | null = null
  private status: SimulatorStatus = {
    phase: 'starting',
    message: 'Opening Xcode Simulator…'
  }

  attach(sender: WebContents): SimulatorStatus {
    this.sender = sender
    this.refs += 1
    if (!this.running) {
      this.running = true
      void this.start()
    }
    return this.status
  }

  detach(): void {
    this.refs = Math.max(0, this.refs - 1)
    if (this.refs > 0) return
    this.stop()
  }

  stop(): void {
    this.refs = 0
    this.epoch += 1
    this.running = false
    this.device = null
    this.mode = null
    this.inputReady = null
    this.streaming = false
    stopInputBridge()
  }

  pointer(raw: unknown): void {
    const event = parsePointer(raw)
    if (!event) return
    sendSimulatorInput({ op: event.phase, x: event.x, y: event.y })
  }

  key(raw: unknown): void {
    const event = parseKey(raw)
    if (!event) return
    sendSimulatorInput({ op: 'key', key: event.key, text: event.text })
  }

  private async start(): Promise<void> {
    const epoch = ++this.epoch
    this.publish({ phase: 'starting', message: 'Opening Xcode Simulator…' })
    try {
      if (process.platform !== 'darwin') {
        throw new SimulatorUnavailable('The iOS Simulator runs on a Mac with Xcode.')
      }
      const simctl = await resolveSimctl()
      if (this.stale(epoch)) return
      this.simctl = simctl
      const device = await ensureIphone(simctl)
      if (this.stale(epoch)) return
      this.device = { udid: device.udid, name: device.name }
      this.publish({ phase: 'starting', message: `Starting ${device.name}…`, deviceName: device.name })
      await bootSimulator(simctl, device.udid)
      if (this.stale(epoch)) return
      await openSimulatorApp(device.udid)
      if (this.stale(epoch)) return
      void startInputBridge(device.name, (trusted) => {
        if (this.stale(epoch)) return
        this.inputReady = trusted
        this.publish(this.status)
      }).then((ready) => {
        if (this.stale(epoch)) return
        if (!ready) {
          this.inputReady = false
          this.publish(this.status)
          return
        }
        if (this.mode) sendSimulatorInput({ op: 'mode', content: this.mode === 'screen' })
        startWindowStream(device.name, (event) => this.onStream(epoch, event))
      })
      this.publish({ phase: 'starting', message: `Waiting for ${device.name}…`, deviceName: device.name })
      this.startPump(epoch)
    } catch (error) {
      if (this.stale(epoch)) return
      const message = error instanceof Error ? error.message : 'Could not open the iOS Simulator'
      this.running = false
      this.publish({ phase: 'unavailable', message })
    }
  }

  private stale(epoch: number): boolean {
    return epoch !== this.epoch || this.refs <= 0
  }

  private startPump(epoch: number): void {
    void this.screenLoop(epoch)
  }

  private onStream(epoch: number, event: StreamEvent): void {
    if (this.stale(epoch)) return
    if (event.type === 'frame') {
      this.streaming = true
      this.publishFrame(event.jpeg, 'window')
    } else if (event.type === 'streaming') {
      this.streaming = true
    } else {
      // Permission missing or window gone: screenshots keep the panel alive.
      this.streaming = false
      if (event.type === 'error') console.error('Simulator window stream:', event.message)
    }
  }

  /**
   * Fallback when the window cannot be streamed (no Screen Recording permission,
   * window hidden). Each screenshot starts a simctl process, so it runs slowly.
   */
  private async screenLoop(epoch: number): Promise<void> {
    while (!this.stale(epoch)) {
      if (this.streaming) {
        await delay(500)
        continue
      }
      if (!this.device || !this.simctl) return
      try {
        const screen = await captureSimulatorScreen(this.simctl, this.device.udid)
        if (this.stale(epoch)) return
        if (screen && !this.streaming) this.publishFrame(screen, 'screen')
      } catch (error) {
        console.error('Simulator frame failed:', error)
      }
      await delay(this.status.phase === 'live' ? 450 : 300)
    }
  }

  private publishFrame(jpeg: Buffer, mode: SimulatorFeed): void {
    if (this.mode !== mode) {
      this.mode = mode
      sendSimulatorInput({ op: 'mode', content: mode === 'screen' })
    }
    if (this.status.phase !== 'live' || this.status.mode !== mode) {
      this.publish({
        phase: 'live',
        message: '',
        deviceName: this.device?.name,
        mode
      })
    }
    this.emit({ type: 'frame', jpeg })
  }

  private publish(status: SimulatorStatus): void {
    this.status = this.inputReady === null ? status : { ...status, inputReady: this.inputReady }
    this.emit({ type: 'status', status: this.status })
  }

  private emit(payload: { type: 'status'; status: SimulatorStatus } | { type: 'frame'; jpeg: Buffer }): void {
    if (!this.sender || this.sender.isDestroyed()) return
    this.sender.send(SIMULATOR_IPC.EVENT, payload)
  }
}

export const simulatorSession = new SimulatorSession()

export function stopSimulatorSession(): void {
  simulatorSession.stop()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

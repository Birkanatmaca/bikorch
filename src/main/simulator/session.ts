import type { WebContents } from 'electron'
import { parseButton, parseKey, parsePointer, SIMULATOR_IPC, type SimulatorFeed, type SimulatorStatus } from '@shared/contracts/simulator'
import { sendSimulatorInput, startInputBridge, startWindowStream, stopInputBridge, type StreamEvent } from './bridge'
import { SimulatorUnavailable } from './devices'
import { sendHeadless, startHeadless, stopHeadless } from './headless'
import { bootSimulator, captureSimulatorScreen, ensureIphone, openSimulatorApp, resolveSimctl, shutdownSimulator } from './simctl'

/** How long a simulator Bikorch booted stays up after its panel closes. */
const SHUTDOWN_GRACE_MS = 2 * 60_000

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
  /** True while the headless helper drives the device (no Simulator.app window). */
  private headless = false
  /** A device Bikorch booted itself; it is shut down again when nobody watches it. */
  private bootedByUs: { simctl: string; udid: string } | null = null
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null
  private sender: WebContents | null = null
  private device: ActiveDevice | null = null
  private simctl: string | null = null
  private mode: SimulatorFeed | null = null
  private inputReady: boolean | null = null
  private status: SimulatorStatus = {
    phase: 'starting',
    message: 'Starting the iOS Simulator…'
  }

  attach(sender: WebContents): SimulatorStatus {
    this.sender = sender
    this.refs += 1
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = null
    }
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
    this.headless = false
    stopHeadless()
    stopInputBridge()
    this.scheduleShutdown()
  }

  /** Simulators the user booted themselves are left running. */
  private scheduleShutdown(): void {
    const booted = this.bootedByUs
    if (!booted || this.shutdownTimer) return
    this.shutdownTimer = setTimeout(() => {
      this.shutdownTimer = null
      if (this.refs > 0 || this.bootedByUs !== booted) return
      this.bootedByUs = null
      void shutdownSimulator(booted.simctl, booted.udid)
    }, SHUTDOWN_GRACE_MS)
  }

  /** App quit: shut down at once what Bikorch started. */
  shutdownNow(): void {
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer)
    this.shutdownTimer = null
    const booted = this.bootedByUs
    this.bootedByUs = null
    if (booted) void shutdownSimulator(booted.simctl, booted.udid)
  }

  pointer(raw: unknown): void {
    const event = parsePointer(raw)
    if (!event) return
    if (this.headless) sendHeadless({ op: event.phase, x: event.x, y: event.y })
    else sendSimulatorInput({ op: event.phase, x: event.x, y: event.y })
  }

  button(raw: unknown): void {
    const button = parseButton(raw)
    if (button && this.headless) sendHeadless({ op: 'button', button })
  }

  key(raw: unknown): void {
    const event = parseKey(raw)
    if (!event) return
    if (this.headless) sendHeadless({ op: 'key', key: event.key, text: event.text })
    else sendSimulatorInput({ op: 'key', key: event.key, text: event.text })
  }

  private async start(): Promise<void> {
    const epoch = ++this.epoch
    this.publish({ phase: 'starting', message: 'Starting the iOS Simulator…' })
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
      if (await bootSimulator(simctl, device.udid)) this.bootedByUs = { simctl, udid: device.udid }
      if (this.stale(epoch)) return
      if (await this.startHeadless(epoch, device.udid)) {
        this.publish({ phase: 'starting', message: `Waiting for ${device.name}…`, deviceName: device.name })
        this.startPump(epoch)
        return
      }
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

  /**
   * Runs the device with no Simulator.app window. Resolves false when this Xcode
   * cannot do that, so the caller falls back to streaming the Simulator window.
   */
  private startHeadless(epoch: number, udid: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const settle = (value: boolean): void => {
        if (settled) return
        settled = true
        resolve(value)
      }
      void startHeadless(udid, (event) => {
        if (this.stale(epoch)) return settle(false)
        if (event.type === 'ready') {
          this.headless = true
          this.inputReady = true
          settle(true)
        } else if (event.type === 'frame') {
          this.streaming = true
          this.publishFrame(event.jpeg, 'device')
        } else {
          if (!settled) console.error('Headless simulator unavailable:', event.message)
          // Lost after it worked: simctl screenshots keep the panel alive.
          this.headless = false
          this.streaming = false
          settle(false)
        }
      })
    })
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
      if (!this.headless) sendSimulatorInput({ op: 'mode', content: mode === 'screen' })
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
  simulatorSession.shutdownNow()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

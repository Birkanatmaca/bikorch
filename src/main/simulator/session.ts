import { desktopCapturer, type WebContents } from 'electron'
import { parseKey, parsePointer, SIMULATOR_IPC, type SimulatorFeed, type SimulatorStatus } from '@shared/contracts/simulator'
import { sendSimulatorInput, startInputBridge, stopInputBridge } from './bridge'
import { pickSimulatorWindow, SimulatorUnavailable } from './devices'
import { bootSimulator, captureSimulatorScreen, ensureIphone, openSimulatorApp, resolveSimctl } from './simctl'

interface ActiveDevice {
  udid: string
  name: string
}

class SimulatorSession {
  private refs = 0
  private epoch = 0
  private running = false
  private lastWindowFrame = 0
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
    this.lastWindowFrame = 0
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
    void this.windowLoop(epoch)
  }

  private async screenLoop(epoch: number): Promise<void> {
    while (!this.stale(epoch)) {
      if (this.mode === 'window' && Date.now() - this.lastWindowFrame < 900) {
        await delay(200)
        continue
      }
      if (!this.device || !this.simctl) return
      try {
        const screen = await captureSimulatorScreen(this.simctl, this.device.udid)
        if (this.stale(epoch)) return
        if (!screen) {
          await delay(300)
          continue
        }
        if (this.mode === 'window' && Date.now() - this.lastWindowFrame < 900) continue
        this.publishFrame(screen, 'screen')
      } catch (error) {
        console.error('Simulator frame failed:', error)
        await delay(400)
      }
    }
  }

  private async windowLoop(epoch: number): Promise<void> {
    while (!this.stale(epoch)) {
      const frame = await this.captureWindow(this.device?.name ?? '')
      if (this.stale(epoch)) return
      if (frame) {
        this.lastWindowFrame = Date.now()
        this.publishFrame(frame, 'window')
        await delay(90)
        continue
      }
      await delay(1_200)
    }
  }

  private async captureWindow(deviceName: string): Promise<Buffer | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 720, height: 1560 },
        fetchWindowIcons: false
      })
      const source = pickSimulatorWindow(sources, deviceName)
      if (!source || source.thumbnail.isEmpty()) return null
      const size = source.thumbnail.getSize()
      if (size.width < 8 || size.height < 8) return null
      return source.thumbnail.toJPEG(74)
    } catch (error) {
      console.error('Simulator window capture failed:', error)
      return null
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

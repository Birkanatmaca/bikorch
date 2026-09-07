const BAR_COUNT = 18
const FFT_SIZE = 512
const MIN_HZ = 40
const MAX_HZ = 16_000
const PEAK_HOLD_MS = 420
const PEAK_FALL = 0.045

let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null
let connectedElement: HTMLAudioElement | null = null
let connectedSrc = ''
let frequencyBuffer: Uint8Array | null = null
let peaks = new Float32Array(BAR_COUNT)
let peakHeldAt = new Float32Array(BAR_COUNT)

export function getVisualizerBarCount(): number {
  return BAR_COUNT
}

function sampleRateHz(): number {
  return audioContext?.sampleRate ?? 44_100
}

function bandRange(index: number): { startBin: number; endBin: number } {
  const bins = (frequencyBuffer?.length ?? FFT_SIZE / 2)
  const nyquist = sampleRateHz() / 2
  const startHz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (index / BAR_COUNT)
  const endHz = MIN_HZ * (MAX_HZ / MIN_HZ) ** ((index + 1) / BAR_COUNT)
  const startBin = Math.max(1, Math.floor((startHz / nyquist) * bins))
  const endBin = Math.max(startBin + 1, Math.ceil((endHz / nyquist) * bins))
  return { startBin, endBin: Math.min(bins, endBin) }
}

function disconnectGraph(): void {
  try {
    sourceNode?.disconnect()
  } catch {
    // already disconnected
  }
  try {
    analyser?.disconnect()
  } catch {
    // already disconnected
  }
  sourceNode = null
  analyser = null
  frequencyBuffer = null
  connectedElement = null
  connectedSrc = ''
}

function captureElementStream(element: HTMLAudioElement): MediaStream | null {
  const media = element as HTMLAudioElement & {
    captureStream?: () => MediaStream
    mozCaptureStream?: () => MediaStream
  }
  try {
    return media.captureStream?.() ?? media.mozCaptureStream?.() ?? null
  } catch {
    return null
  }
}

export function attachPlaybackAnalyser(element: HTMLAudioElement): void {
  if (typeof window === 'undefined' || !element) return
  if (connectedElement === element && connectedSrc === element.currentSrc && analyser) return

  const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return

  disconnectGraph()
  audioContext = audioContext ?? new Context()

  try {
    const nextAnalyser = audioContext.createAnalyser()
    nextAnalyser.fftSize = FFT_SIZE
    nextAnalyser.smoothingTimeConstant = 0.62
    nextAnalyser.minDecibels = -78
    nextAnalyser.maxDecibels = -18

    const stream = captureElementStream(element)
    if (!stream || stream.getAudioTracks().length === 0) return

    const nextSource = audioContext.createMediaStreamSource(stream)
    nextSource.connect(nextAnalyser)
    sourceNode = nextSource
    analyser = nextAnalyser
    frequencyBuffer = new Uint8Array(nextAnalyser.frequencyBinCount)
    connectedElement = element
    connectedSrc = element.currentSrc
    peaks = new Float32Array(BAR_COUNT)
    peakHeldAt = new Float32Array(BAR_COUNT)
  } catch {
    disconnectGraph()
  }
}

export async function resumePlaybackAnalyser(): Promise<void> {
  if (audioContext?.state === 'suspended') {
    try {
      await audioContext.resume()
    } catch {
      // browsers can block resume until a gesture
    }
  }
}

function liveBandLevels(): number[] | null {
  if (!analyser || !frequencyBuffer) return null
  analyser.getByteFrequencyData(frequencyBuffer as Uint8Array<ArrayBuffer>)
  const levels = new Array<number>(BAR_COUNT)
  let energy = 0
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const { startBin, endBin } = bandRange(index)
    let sum = 0
    for (let bin = startBin; bin < endBin; bin += 1) sum += frequencyBuffer[bin] ?? 0
    const raw = sum / Math.max(1, endBin - startBin) / 255
    const shaped = Math.pow(raw, 0.72)
    levels[index] = Math.min(1, shaped * 1.15)
    energy += levels[index]
  }
  if (energy < 0.02) return levels
  return levels
}

function holdPeaks(levels: number[], now: number): number[] {
  const held = new Array<number>(BAR_COUNT)
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const level = levels[index] ?? 0
    if (level >= (peaks[index] ?? 0)) {
      peaks[index] = level
      peakHeldAt[index] = now
    } else if (now - (peakHeldAt[index] ?? 0) > PEAK_HOLD_MS) {
      peaks[index] = Math.max(0, (peaks[index] ?? 0) - PEAK_FALL)
    }
    held[index] = peaks[index] ?? 0
  }
  return held
}

export function readVisualizerState(playing: boolean): { levels: number[]; peaks: number[] } {
  const idle = new Array<number>(BAR_COUNT).fill(playing ? 0.04 : 0.02)
  if (!playing) {
    peaks.fill(0.03)
    return { levels: idle, peaks: Array.from(peaks) }
  }

  const live = liveBandLevels()
  if (!live) return { levels: idle, peaks: idle.map(() => 0.06) }

  return { levels: live, peaks: holdPeaks(live, performance.now()) }
}

export function readVisualizerLevels(playing: boolean, _positionMs = 0): number[] {
  return readVisualizerState(playing).levels
}

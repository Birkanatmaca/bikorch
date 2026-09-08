const BAR_COUNT = 18
const FFT_SIZE = 1024
const MIN_HZ = 40
const MAX_HZ = 16_000
const PEAK_HOLD_MS = 280
const PEAK_FALL = 0.06

let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null
let connectedElement: HTMLAudioElement | null = null
let frequencyBuffer: Uint8Array | null = null
let timeBuffer: Uint8Array | null = null
let peaks = new Float32Array(BAR_COUNT)
let peakHeldAt = new Float32Array(BAR_COUNT)

export function getVisualizerBarCount(): number {
  return BAR_COUNT
}

function sampleRateHz(): number {
  return audioContext?.sampleRate ?? 44_100
}

function bandRange(index: number): { startBin: number; endBin: number } {
  const bins = frequencyBuffer?.length ?? FFT_SIZE / 2
  const nyquist = sampleRateHz() / 2
  const startHz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (index / BAR_COUNT)
  const endHz = MIN_HZ * (MAX_HZ / MIN_HZ) ** ((index + 1) / BAR_COUNT)
  const startBin = Math.max(1, Math.floor((startHz / nyquist) * bins))
  const endBin = Math.max(startBin + 1, Math.ceil((endHz / nyquist) * bins))
  return { startBin, endBin: Math.min(bins, endBin) }
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null
}

export function attachPlaybackAnalyser(element: HTMLAudioElement): void {
  if (typeof window === 'undefined' || !element) return
  const Context = audioContextCtor()
  if (!Context) return

  element.crossOrigin = 'anonymous'
  audioContext = audioContext ?? new Context()

  if (!analyser) {
    const nextAnalyser = audioContext.createAnalyser()
    nextAnalyser.fftSize = FFT_SIZE
    nextAnalyser.smoothingTimeConstant = 0.42
    nextAnalyser.minDecibels = -90
    nextAnalyser.maxDecibels = -18
    nextAnalyser.connect(audioContext.destination)
    analyser = nextAnalyser
    frequencyBuffer = new Uint8Array(nextAnalyser.frequencyBinCount)
    timeBuffer = new Uint8Array(nextAnalyser.fftSize)
  }

  if (connectedElement !== element) {
    try {
      sourceNode = audioContext.createMediaElementSource(element)
      sourceNode.connect(analyser)
    } catch {
      // The element can only be connected once per document lifetime.
    }
    connectedElement = element
  }

  peaks = new Float32Array(BAR_COUNT)
  peakHeldAt = new Float32Array(BAR_COUNT)
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

function frequencyLevels(): number[] | null {
  if (!analyser || !frequencyBuffer) return null
  analyser.getByteFrequencyData(frequencyBuffer as Uint8Array<ArrayBuffer>)
  let loudest = 0
  const levels = new Array<number>(BAR_COUNT)
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const { startBin, endBin } = bandRange(index)
    let sum = 0
    let peak = 0
    for (let bin = startBin; bin < endBin; bin += 1) {
      const value = frequencyBuffer[bin] ?? 0
      sum += value
      if (value > peak) peak = value
    }
    loudest = Math.max(loudest, peak)
    const average = sum / Math.max(1, endBin - startBin) / 255
    const mixed = average * 0.55 + (peak / 255) * 0.45
    levels[index] = Math.min(1, Math.pow(mixed, 0.62) * 1.35)
  }
  return loudest >= 6 ? levels : null
}

function timeDomainLevels(): number[] | null {
  if (!analyser || !timeBuffer) return null
  analyser.getByteTimeDomainData(timeBuffer as Uint8Array<ArrayBuffer>)
  const windowSize = Math.max(1, Math.floor(timeBuffer.length / BAR_COUNT))
  const levels = new Array<number>(BAR_COUNT)
  let energy = 0
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const start = index * windowSize
    const end = index === BAR_COUNT - 1 ? timeBuffer.length : start + windowSize
    let sum = 0
    for (let i = start; i < end; i += 1) {
      const centered = ((timeBuffer[i] ?? 128) - 128) / 128
      sum += centered * centered
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    energy += rms
    levels[index] = Math.min(1, Math.pow(rms * 2.4, 0.7))
  }
  return energy > 0.02 ? levels : null
}

function liveBandLevels(): number[] | null {
  return frequencyLevels() ?? timeDomainLevels()
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

function analyserIsLive(): boolean {
  const element = connectedElement
  if (!analyser || !element) return false
  if (element.paused || element.ended) return false
  return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
}

export function readVisualizerState(playing: boolean): { levels: number[]; peaks: number[] } {
  const idle = new Array<number>(BAR_COUNT).fill(playing ? 0.05 : 0.02)
  if (!playing) {
    peaks.fill(0.03)
    return { levels: idle, peaks: Array.from(peaks) }
  }

  if (!analyserIsLive()) return { levels: idle, peaks: idle.map(() => 0.08) }

  const live = liveBandLevels()
  if (!live) return { levels: idle, peaks: idle.map(() => 0.08) }
  return { levels: live, peaks: holdPeaks(live, performance.now()) }
}

export function readVisualizerLevels(playing: boolean, _positionMs = 0): number[] {
  return readVisualizerState(playing).levels
}

import { useEffect, useRef } from 'react'
import { getVisualizerBarCount, readVisualizerState, resumePlaybackAnalyser } from '@renderer/lib/audio-analyser'

const ROWS = 16

function segmentColor(rowFromTop: number, lit: boolean): string {
  const band = rowFromTop / (ROWS - 1)
  if (!lit) return 'rgb(18 22 16 / 0.92)'
  if (band < 0.18) return '#ff3b30'
  if (band < 0.42) return '#f5c518'
  return '#39d353'
}

function drawPioneer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  levels: number[],
  peaks: number[]
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#070807'
  ctx.fillRect(0, 0, width, height)

  const cols = getVisualizerBarCount()
  const gapX = Math.max(2, width * 0.012)
  const gapY = Math.max(2, height * 0.018)
  const barWidth = (width - gapX * (cols + 1)) / cols
  const segHeight = (height - gapY * (ROWS + 1)) / ROWS

  for (let col = 0; col < cols; col += 1) {
    const level = Math.max(0, Math.min(1, levels[col] ?? 0))
    const peak = Math.max(0, Math.min(1, peaks[col] ?? 0))
    const litRows = Math.round(level * ROWS)
    const peakRow = Math.max(0, ROWS - 1 - Math.round(peak * (ROWS - 1)))
    const x = gapX + col * (barWidth + gapX)

    for (let row = 0; row < ROWS; row += 1) {
      const y = gapY + row * (segHeight + gapY)
      const fromBottom = ROWS - row
      const lit = fromBottom <= litRows
      ctx.fillStyle = segmentColor(row, lit)
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(2, Math.round(barWidth)), Math.max(2, Math.round(segHeight)))
    }

    const peakY = gapY + peakRow * (segHeight + gapY)
    ctx.fillStyle = segmentColor(peakRow, true)
    ctx.fillRect(Math.round(x), Math.round(peakY), Math.max(2, Math.round(barWidth)), Math.max(2, Math.round(segHeight)))
  }
}

export function AudioVisualizer({
  playing
}: {
  playing: boolean
  positionMs?: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    const tick = (): void => {
      if (playing) void resumePlaybackAnalyser()
      const { levels, peaks } = readVisualizerState(playing)
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width > 0 && height > 0) {
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
          canvas.width = Math.round(width * ratio)
          canvas.height = Math.round(height * ratio)
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        drawPioneer(context, width, height, levels, peaks)
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [playing])

  return <canvas ref={canvasRef} className="music-eq-canvas" aria-hidden />
}

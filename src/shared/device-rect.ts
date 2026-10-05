import { DEVICE_MIN_PX, type OrchestratorRect } from './types'

export type DeviceCorner = 'ne' | 'nw' | 'se' | 'sw'

interface CanvasPx { w: number; h: number }

function minDeviceHeight(aspect: number): number {
  return Math.max(DEVICE_MIN_PX.h, DEVICE_MIN_PX.w / aspect)
}

function toPercent(px: { x: number; y: number; w: number; h: number }, canvas: CanvasPx): OrchestratorRect {
  return {
    x: (px.x / canvas.w) * 100,
    y: (px.y / canvas.h) * 100,
    w: (px.w / canvas.w) * 100,
    h: (px.h / canvas.h) * 100
  }
}

/**
 * Corner resize that keeps the device's width / height ratio. The opposite
 * corner stays put, and the device never grows past the canvas edge.
 */
export function resizeDeviceRect(
  start: OrchestratorRect,
  corner: DeviceCorner,
  dxPx: number,
  dyPx: number,
  canvas: CanvasPx,
  aspect: number
): OrchestratorRect {
  if (canvas.w <= 0 || canvas.h <= 0 || !(aspect > 0)) return start
  const left = (start.x / 100) * canvas.w
  const top = (start.y / 100) * canvas.h
  const right = left + (start.w / 100) * canvas.w
  const bottom = top + (start.h / 100) * canvas.h
  const startH = bottom - top
  const xDirection = corner.includes('e') ? 1 : -1
  const yDirection = corner.includes('s') ? 1 : -1
  const growth = (dyPx * yDirection + (dxPx * xDirection) / aspect) / 2
  const maxW = xDirection === 1 ? canvas.w - left : right
  const maxH = Math.min(yDirection === 1 ? canvas.h - bottom + startH : bottom, maxW / aspect)
  const height = Math.min(maxH, Math.max(minDeviceHeight(aspect), startH + growth))
  const width = height * aspect
  return toPercent({
    x: xDirection === 1 ? left : right - width,
    y: yDirection === 1 ? top : bottom - height,
    w: width,
    h: height
  }, canvas)
}

/** Keeps the height and center, then shrinks if the new width would leave the canvas. */
export function fitDeviceRectToAspect(rect: OrchestratorRect, canvas: CanvasPx, aspect: number): OrchestratorRect {
  if (canvas.w <= 0 || canvas.h <= 0 || !(aspect > 0)) return rect
  let height = Math.max(minDeviceHeight(aspect), (rect.h / 100) * canvas.h)
  let width = height * aspect
  if (width > canvas.w) {
    width = canvas.w
    height = width / aspect
  }
  if (height > canvas.h) {
    height = canvas.h
    width = height * aspect
  }
  const centerX = ((rect.x + rect.w / 2) / 100) * canvas.w
  const x = Math.min(canvas.w - width, Math.max(0, centerX - width / 2))
  const y = Math.min(canvas.h - height, Math.max(0, (rect.y / 100) * canvas.h))
  return toPercent({ x, y, w: width, h: height }, canvas)
}

export function sameRect(left: OrchestratorRect, right: OrchestratorRect, tolerance = 0.05): boolean {
  return Math.abs(left.x - right.x) < tolerance && Math.abs(left.y - right.y) < tolerance &&
    Math.abs(left.w - right.w) < tolerance && Math.abs(left.h - right.h) < tolerance
}

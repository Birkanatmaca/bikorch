export interface Box {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/**
 * The device's framebuffer, and so its touch digitizer, stays portrait when it
 * is turned; only the picture is turned in the panel. Maps a point on the
 * turned picture back to the portrait screen.
 */
export function unrotatePoint(point: Point, rotation: 0 | 90 | 270): Point {
  if (rotation === 270) return { x: 1 - point.y, y: point.x }
  if (rotation === 90) return { x: point.y, y: 1 - point.x }
  return point
}

/** Maps a pointer into an object-fit: contain image. Returns null in the letterbox. */
export function normalizeContainedPointer(box: Box, media: Box, localX: number, localY: number): Point | null {
  if (box.width <= 0 || box.height <= 0) return null
  if (media.width <= 0 || media.height <= 0) {
    if (localX < 0 || localY < 0 || localX > box.width || localY > box.height) return null
    return { x: localX / box.width, y: localY / box.height }
  }
  const scale = Math.min(box.width / media.width, box.height / media.height)
  const width = media.width * scale
  const height = media.height * scale
  const originX = (box.width - width) / 2
  const originY = (box.height - height) / 2
  if (localX < originX || localY < originY || localX > originX + width || localY > originY + height) return null
  return {
    x: (localX - originX) / width,
    y: (localY - originY) / height
  }
}

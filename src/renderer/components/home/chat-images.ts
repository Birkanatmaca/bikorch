import {
  HOME_CHAT_IMAGE_TYPES,
  HOME_CHAT_MAX_IMAGE_BYTES,
  type HomeChatImageType
} from '@shared/contracts/dashboard'

/** Longest edge Claude reads at full detail; larger pictures are scaled down. */
const MAX_EDGE = 1568

export interface PreparedImage {
  key: string
  name: string
  mediaType: HomeChatImageType
  /** Base64 without the data: prefix. */
  data: string
  preview: string
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export function isSupportedImage(file: File): boolean {
  return (HOME_CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)
}

/**
 * Turns a picked, pasted or dropped file into something Claude accepts:
 * a supported type, at most 1568px on the long edge and under 5 MB.
 * Animated GIFs that already fit are sent as they are.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!isSupportedImage(file)) throw new Error('Only PNG, JPEG, GIF and WebP images can be sent')
  const name = file.name || 'pasted image'
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const keepAsIs = scale === 1 && file.size <= HOME_CHAT_MAX_IMAGE_BYTES
  if (keepAsIs) {
    bitmap.close()
    const url = await readDataUrl(file)
    return { key, name, mediaType: file.type as HomeChatImageType, data: url.slice(url.indexOf(',') + 1), preview: url }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  // Screenshots stay sharp as PNG; photos or anything still too big become JPEG.
  let blob = file.type === 'image/png' ? await canvasBlob(canvas, 'image/png') : null
  let mediaType: HomeChatImageType = 'image/png'
  if (!blob || blob.size > HOME_CHAT_MAX_IMAGE_BYTES) {
    blob = await canvasBlob(canvas, 'image/jpeg', 0.88)
    mediaType = 'image/jpeg'
  }
  if (!blob || blob.size > HOME_CHAT_MAX_IMAGE_BYTES) throw new Error('This image is too large to send')
  const url = await readDataUrl(blob)
  return { key, name, mediaType, data: url.slice(url.indexOf(',') + 1), preview: url }
}

const cache = new Map<string, Promise<string | null>>()

/** A stored attachment as a data URL, fetched once per image. */
export function loadChatImage(id: string): Promise<string | null> {
  let pending = cache.get(id)
  if (!pending) {
    pending = window.api?.dashboard?.chat.image(id).catch(() => null) ?? Promise.resolve(null)
    cache.set(id, pending)
  }
  return pending
}

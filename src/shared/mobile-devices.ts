export type MobilePlatform = 'ios' | 'android'

export type MobileCutout = 'island' | 'notch' | 'punch-hole' | 'home-button' | 'tablet'

export interface MobileDeviceModel {
  id: string
  platform: MobilePlatform
  name: string
  /** CSS viewport in portrait, the size a page sees as window.innerWidth × innerHeight. */
  viewport: { w: number; h: number }
  dpr: number
  /** Frame thickness around the screen, in CSS px of this device. */
  bezel: number
  /** Extra frame above and below the screen for home-button phones. */
  chin: number
  screenRadius: number
  cutout: MobileCutout
  finish: { edge: string; body: string; shine: string }
  userAgent: string
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const androidUa = (model: string, version = 14): string =>
  `Mozilla/5.0 (Linux; Android ${version}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36`

const TITANIUM = { edge: '#8d8a84', body: '#1d1c1b', shine: '#c9c4ba' }
const GRAPHITE = { edge: '#4a4f58', body: '#111317', shine: '#7d8490' }
const MIDNIGHT = { edge: '#3b4250', body: '#0f1218', shine: '#6b7486' }
const SILVER = { edge: '#b9bcc2', body: '#e7e8ea', shine: '#ffffff' }
const OBSIDIAN = { edge: '#3a3d42', body: '#121315', shine: '#6d7178' }
const PORCELAIN = { edge: '#d7d2c8', body: '#ece8e0', shine: '#ffffff' }
const ONYX = { edge: '#2c2f36', body: '#0c0d10', shine: '#5c626e' }

export const MOBILE_DEVICE_MODELS: readonly MobileDeviceModel[] = [
  { id: 'iphone-16-pro-max', platform: 'ios', name: 'iPhone 16 Pro Max', viewport: { w: 440, h: 956 }, dpr: 3, bezel: 13, chin: 0, screenRadius: 62, cutout: 'island', finish: TITANIUM, userAgent: IOS_UA },
  { id: 'iphone-16-pro', platform: 'ios', name: 'iPhone 16 Pro', viewport: { w: 402, h: 874 }, dpr: 3, bezel: 12, chin: 0, screenRadius: 58, cutout: 'island', finish: TITANIUM, userAgent: IOS_UA },
  { id: 'iphone-15', platform: 'ios', name: 'iPhone 15', viewport: { w: 393, h: 852 }, dpr: 3, bezel: 15, chin: 0, screenRadius: 55, cutout: 'island', finish: MIDNIGHT, userAgent: IOS_UA },
  { id: 'iphone-14', platform: 'ios', name: 'iPhone 14', viewport: { w: 390, h: 844 }, dpr: 3, bezel: 15, chin: 0, screenRadius: 47, cutout: 'notch', finish: GRAPHITE, userAgent: IOS_UA },
  { id: 'iphone-se', platform: 'ios', name: 'iPhone SE', viewport: { w: 375, h: 667 }, dpr: 2, bezel: 14, chin: 72, screenRadius: 3, cutout: 'home-button', finish: SILVER, userAgent: IOS_UA },
  { id: 'ipad-mini', platform: 'ios', name: 'iPad mini', viewport: { w: 744, h: 1133 }, dpr: 2, bezel: 28, chin: 0, screenRadius: 22, cutout: 'tablet', finish: GRAPHITE, userAgent: IPAD_UA },
  { id: 'pixel-9-pro', platform: 'android', name: 'Pixel 9 Pro', viewport: { w: 410, h: 914 }, dpr: 3.125, bezel: 12, chin: 0, screenRadius: 46, cutout: 'punch-hole', finish: PORCELAIN, userAgent: androidUa('Pixel 9 Pro', 15) },
  { id: 'pixel-8', platform: 'android', name: 'Pixel 8', viewport: { w: 412, h: 915 }, dpr: 2.625, bezel: 14, chin: 0, screenRadius: 40, cutout: 'punch-hole', finish: OBSIDIAN, userAgent: androidUa('Pixel 8') },
  { id: 'galaxy-s24', platform: 'android', name: 'Galaxy S24', viewport: { w: 360, h: 780 }, dpr: 3, bezel: 10, chin: 0, screenRadius: 36, cutout: 'punch-hole', finish: ONYX, userAgent: androidUa('SM-S921B') },
  { id: 'galaxy-s24-ultra', platform: 'android', name: 'Galaxy S24 Ultra', viewport: { w: 384, h: 824 }, dpr: 3.75, bezel: 9, chin: 0, screenRadius: 12, cutout: 'punch-hole', finish: TITANIUM, userAgent: androidUa('SM-S928B') },
  { id: 'galaxy-z-fold5', platform: 'android', name: 'Galaxy Z Fold5', viewport: { w: 344, h: 882 }, dpr: 2.625, bezel: 11, chin: 0, screenRadius: 24, cutout: 'punch-hole', finish: ONYX, userAgent: androidUa('SM-F946B') }
]

export const DEFAULT_MOBILE_MODEL: Record<MobilePlatform, string> = {
  ios: 'iphone-16-pro',
  android: 'pixel-8'
}

export function mobileModelsFor(platform: MobilePlatform): MobileDeviceModel[] {
  return MOBILE_DEVICE_MODELS.filter((model) => model.platform === platform)
}

/** Unknown or other-platform IDs fall back to the platform default. */
export function resolveMobileModel(platform: MobilePlatform, id: string | undefined): MobileDeviceModel {
  const match = MOBILE_DEVICE_MODELS.find((model) => model.id === id && model.platform === platform)
  if (match) return match
  return MOBILE_DEVICE_MODELS.find((model) => model.id === DEFAULT_MOBILE_MODEL[platform]) as MobileDeviceModel
}

export interface RoundedBox { x: number; y: number; w: number; h: number; r: number }

export interface MobileDeviceGeometry {
  frame: RoundedBox
  screen: RoundedBox
  cutout: RoundedBox
  /** Bottom gesture bar. Absent on home-button phones. */
  indicator: RoundedBox | null
  homeButton: { cx: number; cy: number; r: number } | null
  buttons: Array<{ side: 'left' | 'right'; y: number; h: number }>
}

/** Everything in CSS px of the device, so callers multiply by one scale to draw it. */
export function mobileDeviceGeometry(model: MobileDeviceModel): MobileDeviceGeometry {
  const { w, h } = model.viewport
  const frameW = w + model.bezel * 2
  const frameH = h + (model.bezel + model.chin) * 2
  const screen = { x: model.bezel, y: model.bezel + model.chin, w, h, r: model.screenRadius }
  const frame = { x: 0, y: 0, w: frameW, h: frameH, r: model.cutout === 'home-button' ? 58 : model.screenRadius + model.bezel }
  const centerX = frameW / 2
  const cutout = (() => {
    switch (model.cutout) {
      case 'island': {
        const islandW = Math.round(w * 0.317)
        return { x: centerX - islandW / 2, y: screen.y + 11, w: islandW, h: 36, r: 18 }
      }
      case 'notch': {
        const notchW = Math.round(w * 0.41)
        return { x: centerX - notchW / 2, y: screen.y, w: notchW, h: 32, r: 18 }
      }
      case 'punch-hole':
        return { x: centerX - 6, y: screen.y + 12, w: 12, h: 12, r: 6 }
      case 'home-button':
        return { x: centerX - 32, y: model.bezel + model.chin / 2 - 3, w: 64, h: 6, r: 3 }
      case 'tablet':
        return { x: centerX - 4, y: model.bezel / 2 - 4, w: 8, h: 8, r: 4 }
    }
  })()
  const indicatorW = model.platform === 'ios' ? Math.round(w * 0.35) : Math.round(w * 0.27)
  const indicator = model.cutout === 'home-button'
    ? null
    : { x: centerX - indicatorW / 2, y: screen.y + h - 13, w: indicatorW, h: 5, r: 2.5 }
  const homeButton = model.cutout === 'home-button'
    ? { cx: centerX, cy: screen.y + h + model.chin / 2 + model.bezel / 2, r: 26 }
    : null
  const buttons = model.platform === 'ios'
    ? [
        { side: 'left' as const, y: frameH * 0.17, h: frameH * 0.035 },
        { side: 'left' as const, y: frameH * 0.24, h: frameH * 0.07 },
        { side: 'left' as const, y: frameH * 0.33, h: frameH * 0.07 },
        { side: 'right' as const, y: frameH * 0.26, h: frameH * 0.11 }
      ]
    : [
        { side: 'right' as const, y: frameH * 0.2, h: frameH * 0.06 },
        { side: 'right' as const, y: frameH * 0.3, h: frameH * 0.13 }
      ]
  return { frame, screen, cutout, indicator, homeButton, buttons }
}

/** Width over height of the whole device, used to keep resizing proportional. */
export function mobileDeviceAspect(model: MobileDeviceModel): number {
  const { frame } = mobileDeviceGeometry(model)
  return frame.w / frame.h
}

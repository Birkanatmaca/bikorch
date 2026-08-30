export function getPlatform(): NodeJS.Platform {
  return window.api?.platform ?? 'win32'
}

export function isWindows(): boolean {
  return getPlatform() === 'win32'
}

export function hasApi(): boolean {
  return typeof window.api !== 'undefined'
}

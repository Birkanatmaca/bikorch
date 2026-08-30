import type { ITheme, ITerminalOptions } from '@xterm/xterm'
import type { PtyKind } from '@shared/contracts/pty'

export const TERMINAL_THEME: ITheme = {
  background: '#0D0F12',
  foreground: '#E8EDF4',
  cursor: '#A78BFA',
  cursorAccent: '#0D0F12',
  selectionBackground: '#7C6CF255',
  selectionForeground: '#FFFFFF',
  selectionInactiveBackground: '#7C6CF230',
  black: '#1B1F27',
  red: '#FF6B7A',
  green: '#4ADE80',
  yellow: '#F5C14A',
  blue: '#6CB6FF',
  magenta: '#C4B5FD',
  cyan: '#2DD4BF',
  white: '#E8EDF4',
  brightBlack: '#7B8494',
  brightRed: '#FF8A94',
  brightGreen: '#86EFAC',
  brightYellow: '#FDE68A',
  brightBlue: '#93C5FD',
  brightMagenta: '#DDD6FE',
  brightCyan: '#5EEAD4',
  brightWhite: '#FFFFFF'
}

const BASE_TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorWidth: 1,
  disableStdin: false,
  fontFamily: "'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, ui-monospace, monospace",
  fontWeight: '400',
  fontWeightBold: '700',
  letterSpacing: 0,
  theme: TERMINAL_THEME,
  allowProposedApi: true,
  drawBoldTextInBrightColors: true,
  scrollback: 8000,
  smoothScrollDuration: 0,
  overviewRulerWidth: 0,
  rescaleOverlappingGlyphs: true,
  customGlyphs: true,
  minimumContrastRatio: 1
}

export const TERMINAL_OPTIONS: ITerminalOptions = {
  ...BASE_TERMINAL_OPTIONS,
  fontSize: 13,
  lineHeight: 1.15
}

export function getTerminalOptions(kind: PtyKind): ITerminalOptions {
  if (
    kind === 'cursor' ||
    kind === 'claude' ||
    kind === 'gemini' ||
    kind === 'antigravity' ||
    kind === 'codex'
  ) {
    return {
      ...BASE_TERMINAL_OPTIONS,
      fontSize: 12,
      lineHeight: 1
    }
  }

  return TERMINAL_OPTIONS
}

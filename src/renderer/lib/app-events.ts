export const COMMAND_PALETTE_EVENT = 'bikorch:open-command-palette'
export const ADD_PANEL_MENU_EVENT = 'bikorch:open-add-panel-menu'
export const FOCUS_TERMINAL_EVENT = 'bikorch:focus-terminal'
export const TERMINAL_LAYOUT_LOCK_EVENT = 'bikorch:terminal-layout-lock'
export const AI_ACCOUNTS_REFRESH_EVENT = 'bikorch:refresh-ai-accounts'
export const AI_ACCOUNT_AUTHENTICATED_EVENT = 'bikorch:ai-account-authenticated'

export function focusTerminal(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(FOCUS_TERMINAL_EVENT, { detail: sessionId }))
}

export function lockTerminalLayout(panelId: string): void {
  window.dispatchEvent(
    new CustomEvent(TERMINAL_LAYOUT_LOCK_EVENT, { detail: { panelId, locked: true } })
  )
}

export function unlockTerminalLayout(panelId: string | null = null): void {
  window.dispatchEvent(
    new CustomEvent(TERMINAL_LAYOUT_LOCK_EVENT, { detail: { panelId, locked: false } })
  )
}

export function isTypingInTerminal(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('.xterm') ||
      target.closest('[data-terminal-session]') ||
      target.classList.contains('xterm-helper-textarea')
  )
}

import type { PanelType } from '@shared/types'
import claudeLogo from '@renderer/assets/claude-cli-app-logo.jpeg'
import cursorLogo from '@renderer/assets/cursor-cli-app-logo.png'
import geminiLogo from '@renderer/assets/gemini-cli-app-logo.png'
import antigravityLogo from '@renderer/assets/antigravity-cli-app-logo.png'
import codexLogo from '@renderer/assets/codex-cli-app-logo.png'
import chatgptLogo from '@renderer/assets/open-ai-logo.png'

const CLI_LOGOS: Partial<Record<PanelType, string>> = {
  claude: claudeLogo,
  cursor: cursorLogo,
  gemini: geminiLogo,
  antigravity: antigravityLogo,
  codex: codexLogo,
  chatgpt: chatgptLogo,
  'claude-chat': claudeLogo
}

export const CLI_LOGO_CLASS =
  'h-6 w-6 shrink-0 rounded-md border border-border bg-elevated p-0.5 object-contain'

export function getCliLogo(type: PanelType): string | null {
  return CLI_LOGOS[type] ?? null
}

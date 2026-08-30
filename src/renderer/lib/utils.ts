import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function getPanelTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    terminal: '⌘',
    claude: '◆',
    cursor: '▸',
    gemini: '✦',
    antigravity: '◈',
    codex: '⌘',
    chatgpt: '✺',
    'claude-chat': '◆',
    'file-explorer': '▤',
    'git-changes': '⎇',
    diff: '◇',
    logs: '≡',
    tasks: '☑',
    usage: '◷'
  }
  return icons[type] ?? '□'
}

export function formatProjectName(path: string | null, fallback: string): string {
  if (!path) return fallback
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || fallback
}

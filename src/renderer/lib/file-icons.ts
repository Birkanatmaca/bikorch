import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  File,
  FileCode2,
  FileJson,
  FileText,
  FileType,
  Image,
  Settings2,
  Terminal
} from 'lucide-react'

export type FileIconSpec = {
  icon: LucideIcon
  className: string
}

export function detectLanguage(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile'
  if (base === 'makefile') return 'plaintext'

  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    txt: 'plaintext',
    log: 'plaintext',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    dart: 'dart',
    php: 'php',
    rb: 'ruby',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    vue: 'html',
    svelte: 'html',
    graphql: 'graphql',
    toml: 'ini',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    gradle: 'groovy',
    properties: 'ini'
  }
  return map[ext] ?? 'plaintext'
}

export function getFileIconSpec(fileName: string): FileIconSpec {
  const base = fileName.toLowerCase()
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : base

  if (['ts', 'tsx'].includes(ext)) return { icon: FileCode2, className: 'text-[#3178c6]' }
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return { icon: FileCode2, className: 'text-[#f7df1e]' }
  if (['json', 'jsonc'].includes(ext)) return { icon: FileJson, className: 'text-[#cbcb41]' }
  if (['md', 'markdown', 'txt', 'log'].includes(ext)) return { icon: FileText, className: 'text-text-secondary' }
  if (['css', 'scss', 'less'].includes(ext)) return { icon: FileType, className: 'text-[#c586c0]' }
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return { icon: FileCode2, className: 'text-[#e34c26]' }
  if (['yml', 'yaml', 'toml', 'ini', 'env', 'properties'].includes(ext) || base.startsWith('.env')) {
    return { icon: Settings2, className: 'text-warning' }
  }
  if (['py'].includes(ext)) return { icon: FileCode2, className: 'text-[#3572a5]' }
  if (['rs'].includes(ext)) return { icon: FileCode2, className: 'text-[#dea584]' }
  if (['go'].includes(ext)) return { icon: FileCode2, className: 'text-[#00add8]' }
  if (['java', 'kt', 'kts'].includes(ext)) return { icon: FileCode2, className: 'text-[#b07219]' }
  if (['swift'].includes(ext)) return { icon: FileCode2, className: 'text-[#f05138]' }
  if (['dart'].includes(ext)) return { icon: FileCode2, className: 'text-[#00b4ab]' }
  if (['php'].includes(ext)) return { icon: FileCode2, className: 'text-[#4f5d95]' }
  if (['rb'].includes(ext)) return { icon: FileCode2, className: 'text-[#701516]' }
  if (['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs'].includes(ext)) {
    return { icon: FileCode2, className: 'text-info' }
  }
  if (['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'].includes(ext)) {
    return { icon: Terminal, className: 'text-success' }
  }
  if (['sql'].includes(ext)) return { icon: Braces, className: 'text-[#e38c00]' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
    return { icon: Image, className: 'text-[#a074c4]' }
  }
  if (['xml', 'graphql'].includes(ext)) return { icon: Braces, className: 'text-info' }

  return { icon: File, className: 'text-text-muted' }
}

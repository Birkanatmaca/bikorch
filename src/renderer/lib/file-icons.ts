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
  kind: string
}

export function getFileIconSpec(fileName: string): FileIconSpec {
  const base = fileName.toLowerCase()
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : base

  if (['ts', 'tsx'].includes(ext)) return { icon: FileCode2, kind: 'ts' }
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return { icon: FileCode2, kind: 'js' }
  if (['json', 'jsonc'].includes(ext)) return { icon: FileJson, kind: 'json' }
  if (['md', 'markdown', 'txt', 'log'].includes(ext)) return { icon: FileText, kind: 'doc' }
  if (['css', 'scss', 'less'].includes(ext)) return { icon: FileType, kind: 'css' }
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return { icon: FileCode2, kind: 'html' }
  if (['yml', 'yaml', 'toml', 'ini', 'env', 'properties'].includes(ext) || base.startsWith('.env')) {
    return { icon: Settings2, kind: 'config' }
  }
  if (['py'].includes(ext)) return { icon: FileCode2, kind: 'py' }
  if (['rs'].includes(ext)) return { icon: FileCode2, kind: 'rs' }
  if (['go'].includes(ext)) return { icon: FileCode2, kind: 'go' }
  if (['java', 'kt', 'kts'].includes(ext)) return { icon: FileCode2, kind: 'jvm' }
  if (['swift'].includes(ext)) return { icon: FileCode2, kind: 'swift' }
  if (['dart'].includes(ext)) return { icon: FileCode2, kind: 'dart' }
  if (['php'].includes(ext)) return { icon: FileCode2, kind: 'php' }
  if (['rb'].includes(ext)) return { icon: FileCode2, kind: 'rb' }
  if (['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs'].includes(ext)) return { icon: FileCode2, kind: 'c' }
  if (['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'].includes(ext)) return { icon: Terminal, kind: 'shell' }
  if (['sql'].includes(ext)) return { icon: Braces, kind: 'sql' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return { icon: Image, kind: 'image' }
  if (['xml', 'graphql'].includes(ext)) return { icon: Braces, kind: 'data' }

  return { icon: File, kind: 'file' }
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

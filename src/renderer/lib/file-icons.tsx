import type { LucideIcon } from 'lucide-react'
import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileType2
} from 'lucide-react'
import { cn } from './utils'

interface FileIconSpec {
  Icon: LucideIcon
  className: string
}

const ICONS: Record<string, FileIconSpec> = {
  ts: { Icon: FileCode, className: 'text-[#3178c6]' },
  tsx: { Icon: FileCode, className: 'text-[#3178c6]' },
  js: { Icon: FileCode, className: 'text-[#f7df1e]' },
  jsx: { Icon: FileCode, className: 'text-[#61dafb]' },
  mjs: { Icon: FileCode, className: 'text-[#f7df1e]' },
  cjs: { Icon: FileCode, className: 'text-[#f7df1e]' },
  json: { Icon: FileJson, className: 'text-[#cbcb41]' },
  md: { Icon: FileText, className: 'text-[#519aba]' },
  markdown: { Icon: FileText, className: 'text-[#519aba]' },
  txt: { Icon: FileText, className: 'text-text-muted' },
  log: { Icon: FileText, className: 'text-text-muted' },
  css: { Icon: FileCode, className: 'text-[#563d7c]' },
  scss: { Icon: FileCode, className: 'text-[#c6538c]' },
  less: { Icon: FileCode, className: 'text-[#1d365d]' },
  html: { Icon: FileCode, className: 'text-[#e34c26]' },
  htm: { Icon: FileCode, className: 'text-[#e34c26]' },
  xml: { Icon: FileCode, className: 'text-[#e37933]' },
  svg: { Icon: FileImage, className: 'text-[#ffb13b]' },
  yml: { Icon: FileCog, className: 'text-[#cb171e]' },
  yaml: { Icon: FileCog, className: 'text-[#cb171e]' },
  py: { Icon: FileCode, className: 'text-[#3572a5]' },
  rs: { Icon: FileCode, className: 'text-[#dea584]' },
  go: { Icon: FileCode, className: 'text-[#00add8]' },
  sql: { Icon: FileCode, className: 'text-[#e38c00]' },
  sh: { Icon: FileCog, className: 'text-[#89e051]' },
  bash: { Icon: FileCog, className: 'text-[#89e051]' },
  ps1: { Icon: FileCog, className: 'text-[#2671be]' },
  java: { Icon: FileCode, className: 'text-[#b07219]' },
  kt: { Icon: FileCode, className: 'text-[#a97bff]' },
  kts: { Icon: FileCode, className: 'text-[#a97bff]' },
  swift: { Icon: FileCode, className: 'text-[#f05138]' },
  dart: { Icon: FileCode, className: 'text-[#00b4ab]' },
  php: { Icon: FileCode, className: 'text-[#4f5d95]' },
  rb: { Icon: FileCode, className: 'text-[#701516]' },
  c: { Icon: FileCode, className: 'text-[#555555]' },
  h: { Icon: FileType2, className: 'text-[#555555]' },
  cpp: { Icon: FileCode, className: 'text-[#f34b7d]' },
  cs: { Icon: FileCode, className: 'text-[#178600]' },
  vue: { Icon: FileCode, className: 'text-[#41b883]' },
  svelte: { Icon: FileCode, className: 'text-[#ff3e00]' },
  graphql: { Icon: FileCode, className: 'text-[#e535ab]' },
  toml: { Icon: FileCog, className: 'text-[#9c4221]' },
  ini: { Icon: FileCog, className: 'text-text-muted' },
  env: { Icon: FileCog, className: 'text-[#ecd53f]' },
  lock: { Icon: FileCog, className: 'text-text-muted' },
  png: { Icon: FileImage, className: 'text-[#a074c4]' },
  jpg: { Icon: FileImage, className: 'text-[#a074c4]' },
  jpeg: { Icon: FileImage, className: 'text-[#a074c4]' },
  gif: { Icon: FileImage, className: 'text-[#a074c4]' },
  webp: { Icon: FileImage, className: 'text-[#a074c4]' },
  ico: { Icon: FileImage, className: 'text-[#a074c4]' },
  zip: { Icon: FileArchive, className: 'text-[#c9a227]' },
  gz: { Icon: FileArchive, className: 'text-[#c9a227]' }
}

function specForName(fileName: string): FileIconSpec {
  const lower = fileName.toLowerCase()
  if (lower === 'dockerfile') return { Icon: FileCog, className: 'text-[#384d54]' }
  if (lower === '.gitignore' || lower === '.gitattributes') {
    return { Icon: FileCog, className: 'text-[#f05032]' }
  }
  const ext = lower.includes('.') ? lower.split('.').pop() ?? '' : ''
  return ICONS[ext] ?? { Icon: File, className: 'text-text-muted' }
}

export function FileTypeIcon({
  fileName,
  className
}: {
  fileName: string
  className?: string
}): React.JSX.Element {
  const { Icon, className: color } = specForName(fileName)
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', color, className)} />
}

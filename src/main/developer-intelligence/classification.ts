import { detectLanguage } from '@shared/lib/languages'
import type { WorkCategory } from '@shared/contracts/developer-intelligence'

/**
 * Local, heuristic classification. No network, no model.
 * Results are labelled as heuristics in the UI and never presented as skill level.
 */

interface CategoryRule {
  category: WorkCategory
  patterns: RegExp[]
  weight: number
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'Debugging',
    weight: 3,
    patterns: [
      /\b(bug|debug|fix(?:es|ed|ing)?|broken|crash(?:es|ing)?|error|exception|stack ?trace|fail(?:s|ed|ing)?|not working|doesn'?t work|undefined is not|null pointer|regression|hata|çalışmıyor|düzelt)\b/i
    ]
  },
  {
    category: 'Testing',
    weight: 3,
    patterns: [/\b(test(?:s|ing)?|spec|coverage|vitest|jest|mocha|pytest|unit test|e2e|assert(?:ion)?s?|mock(?:s|ing)?)\b/i]
  },
  {
    category: 'Refactoring',
    weight: 3,
    patterns: [/\b(refactor(?:ing)?|clean ?up|simplify|extract|rename|reorganize|restructure|dedupe|deduplicate|tidy|sadeleştir|yeniden düzenle)\b/i]
  },
  {
    category: 'Documentation',
    weight: 3,
    patterns: [/\b(docs?|documentation|readme|changelog|comment(?:s)?|docstring|jsdoc|tsdoc|explain in the readme|dokümantasyon|belge)\b/i]
  },
  {
    category: 'DevOps',
    weight: 3,
    patterns: [
      /\b(docker|dockerfile|compose|kubernetes|k8s|helm|ci\/?cd|github actions|pipeline|deploy(?:ment)?|terraform|ansible|nginx|systemd|release build|electron-builder|notariz(?:e|ation)|sign(?:ing)? the app)\b/i
    ]
  },
  {
    category: 'Architecture',
    weight: 3,
    patterns: [/\b(architecture|design (?:the )?(?:system|api|schema)|data model|schema|module boundar(?:y|ies)|dependency graph|ipc contract|layer(?:ing)?|mimari|tasarım)\b/i]
  },
  {
    category: 'Code review',
    weight: 3,
    patterns: [/\b(review|pull request|\bpr\b|merge request|code smell|nitpick|lgtm|approve|gözden geçir)\b/i]
  },
  {
    category: 'Research',
    weight: 2,
    patterns: [/\b(how (?:do|does|can|should)|what is|what does|why does|explain|compare|difference between|research|investigate|options for|best way to|nasıl|nedir|neden)\b/i]
  },
  {
    category: 'Feature development',
    weight: 1,
    patterns: [/\b(add|implement|create|build|feature|support for|new (?:page|panel|component|endpoint|command)|ekle|oluştur|yap)\b/i]
  }
]

export function classifyWorkCategory(text: string): WorkCategory | undefined {
  const normalized = text.trim()
  if (!normalized) return undefined

  const scores = new Map<WorkCategory, number>()
  for (const rule of CATEGORY_RULES) {
    let hits = 0
    for (const pattern of rule.patterns) {
      const matches = normalized.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))
      hits += matches?.length ?? 0
    }
    if (hits > 0) scores.set(rule.category, hits * rule.weight)
  }

  if (scores.size === 0) return 'Feature development'

  let best: WorkCategory = 'Feature development'
  let bestScore = -1
  for (const [category, score] of scores) {
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }
  return best
}

const FENCE_LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  python: 'python',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  java: 'java',
  kt: 'kotlin',
  kotlin: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  php: 'php',
  rb: 'ruby',
  ruby: 'ruby',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  css: 'css',
  scss: 'scss',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  dockerfile: 'dockerfile'
}

const NON_CODE_LANGUAGES = new Set(['plaintext', 'json', 'markdown', 'yaml', 'ini', 'xml'])

/**
 * Extracts language hints from a prompt: fenced code block tags and file names with
 * known extensions. Prompt hints alone are treated as weak evidence by the metrics engine.
 */
export function detectLanguageHints(text: string): string[] {
  const hints = new Set<string>()

  for (const match of text.matchAll(/```([A-Za-z0-9+#-]{1,20})\b/g)) {
    const alias = match[1].toLowerCase()
    const language = FENCE_LANGUAGE_ALIASES[alias]
    if (language) hints.add(language)
  }

  for (const match of text.matchAll(/(?:^|[\s"'`(/\\])([\w./\\-]+\.([A-Za-z0-9]{1,8}))(?=$|[\s"'`):,;])/g)) {
    const fileName = match[1]
    if (/^\d+\.\d+/.test(fileName)) continue // versions like 1.2.3
    const language = detectLanguage(fileName)
    if (language && !NON_CODE_LANGUAGES.has(language)) hints.add(language)
  }

  return [...hints].sort()
}

export function languageCensusFromFiles(files: string[]): Record<string, number> {
  const census: Record<string, number> = {}
  for (const file of files) {
    const language = detectLanguage(file)
    const key = language === 'plaintext' ? 'unknown' : language
    census[key] = (census[key] ?? 0) + 1
  }
  return census
}

interface FrameworkRule {
  name: string
  /** Matches against package.json dependency names. */
  packages?: string[]
  /** Matches against file names present in the project root. */
  files?: RegExp[]
  /** Matches against prompt text (weak evidence). */
  prompt?: RegExp
}

export const FRAMEWORK_RULES: FrameworkRule[] = [
  { name: 'React', packages: ['react', 'react-dom'], prompt: /\breact\b|\buse(?:state|effect|memo)\b|\.tsx\b/i },
  { name: 'Electron', packages: ['electron', 'electron-vite', 'electron-builder'], prompt: /\belectron\b|ipcmain|ipcrenderer|contextbridge/i },
  { name: 'Next.js', packages: ['next'], files: [/^next\.config\.(?:js|mjs|ts)$/], prompt: /\bnext\.?js\b|app router|getserversideprops/i },
  { name: 'NestJS', packages: ['@nestjs/core', '@nestjs/common'], prompt: /\bnest(?:js)?\b|@injectable|@controller/i },
  { name: 'Node.js', packages: ['express', 'fastify', 'koa', 'hono'], files: [/^package\.json$/], prompt: /\bnode(?:\.js)?\b|\bnpm\b|\bexpress\b|\bfastify\b/i },
  { name: 'Vue', packages: ['vue', 'nuxt'], prompt: /\bvue\b|\bnuxt\b/i },
  { name: 'Svelte', packages: ['svelte', '@sveltejs/kit'], prompt: /\bsvelte(?:kit)?\b/i },
  { name: 'Tailwind CSS', packages: ['tailwindcss'], prompt: /\btailwind\b/i },
  { name: 'Vite', packages: ['vite'], files: [/^vite\.config\.(?:js|mjs|ts)$/], prompt: /\bvite\b/i },
  { name: 'Go standard library', files: [/^go\.mod$/], prompt: /\bgolang\b|\bgo\s+(?:mod|run|build|test)\b|net\/http|goroutine/i },
  { name: 'Docker', files: [/^dockerfile$/i, /^docker-compose\.ya?ml$/, /^compose\.ya?ml$/], prompt: /\bdocker(?:file|-compose)?\b|\bcontainer(?:s|ize)?\b/i },
  { name: 'PostgreSQL', packages: ['pg', 'postgres', 'prisma', '@prisma/client', 'drizzle-orm', 'typeorm', 'knex'], prompt: /\bpostgres(?:ql)?\b|\bpsql\b|\bprisma\b|\bdrizzle\b/i },
  { name: 'SQLite', packages: ['sql.js', 'better-sqlite3', 'sqlite3'], prompt: /\bsqlite\b|sql\.js/i },
  { name: 'Python', files: [/^requirements\.txt$/, /^pyproject\.toml$/, /^pipfile$/i], prompt: /\bpython\b|\bpip\b|\bpytest\b|\bdjango\b|\bfastapi\b|\bflask\b/i },
  { name: 'Rust / Cargo', files: [/^cargo\.toml$/i], prompt: /\bcargo\b|\brustc?\b|\btokio\b/i },
  { name: 'Kubernetes', files: [/^helm$/, /^skaffold\.ya?ml$/], prompt: /\bkubernetes\b|\bk8s\b|\bkubectl\b|\bhelm\b/i },
  { name: 'GitHub Actions', files: [/^\.github$/], prompt: /github actions|\bworkflow_dispatch\b|\bactions\/checkout\b/i }
]

export function detectFrameworkHintsFromPrompt(text: string): string[] {
  const hits: string[] = []
  for (const rule of FRAMEWORK_RULES) {
    if (rule.prompt && rule.prompt.test(text)) hits.push(rule.name)
  }
  return hits
}

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { detectLanguage } from '@shared/lib/languages'
import { FRAMEWORK_RULES } from './classification'
import type { ProjectCensus } from './metrics'

/**
 * Local-only census of a project folder used for the "Language activity distribution".
 * Bounded so it never becomes expensive; results are cached per folder for a few minutes.
 */

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'release',
  '.cache',
  'coverage',
  '.next',
  '.turbo',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv'
])

const MAX_FILES = 4000
const MAX_DEPTH = 8
const CACHE_TTL_MS = 10 * 60 * 1000
const NON_CODE_LANGUAGES = new Set(['plaintext', 'json', 'markdown', 'yaml', 'ini', 'xml'])

interface CachedCensus {
  computedAt: number
  census: Omit<ProjectCensus, 'projectId'>
}

const cache = new Map<string, CachedCensus>()

async function detectFrameworksFromRoot(folderPath: string, rootEntries: string[]): Promise<string[]> {
  const frameworks = new Set<string>()
  const lowerEntries = rootEntries.map((entry) => entry.toLowerCase())

  let dependencyNames: string[] = []
  if (rootEntries.includes('package.json')) {
    try {
      const raw = await readFile(join(folderPath, 'package.json'), 'utf8')
      const parsed = JSON.parse(raw) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      dependencyNames = [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {})
      ].map((name) => name.toLowerCase())
    } catch {
      dependencyNames = []
    }
  }

  for (const rule of FRAMEWORK_RULES) {
    if (rule.packages?.some((pkg) => dependencyNames.includes(pkg.toLowerCase()))) {
      frameworks.add(rule.name)
      continue
    }
    if (rule.files?.some((pattern) => lowerEntries.some((entry) => pattern.test(entry)))) {
      frameworks.add(rule.name)
    }
  }

  return [...frameworks]
}

export async function scanProjectLanguages(
  folderPath: string
): Promise<Omit<ProjectCensus, 'projectId'>> {
  const cached = cache.get(folderPath)
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) return cached.census

  const byLanguage: Record<string, number> = {}
  let fileCount = 0
  let rootEntries: string[] = []

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (fileCount >= MAX_FILES || depth > MAX_DEPTH) return
    let names: string[]
    try {
      names = await readdir(directory)
    } catch {
      return
    }
    if (depth === 0) rootEntries = names

    for (const name of names) {
      if (fileCount >= MAX_FILES) return
      if (name.startsWith('.') && depth > 0) continue
      if (SKIP_DIRS.has(name)) continue
      const fullPath = join(directory, name)
      let entryStat
      try {
        entryStat = await stat(fullPath)
      } catch {
        continue
      }
      if (entryStat.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (entryStat.isFile()) {
        const language = detectLanguage(name)
        if (NON_CODE_LANGUAGES.has(language)) continue
        fileCount += 1
        byLanguage[language] = (byLanguage[language] ?? 0) + 1
      }
    }
  }

  try {
    const rootStat = await stat(folderPath)
    if (rootStat.isDirectory()) await walk(folderPath, 0)
  } catch {
    // inaccessible folder — return an empty census
  }

  const frameworks = rootEntries.length > 0 ? await detectFrameworksFromRoot(folderPath, rootEntries) : []
  const census = { fileCount, byLanguage, frameworks }
  cache.set(folderPath, { computedAt: Date.now(), census })
  return census
}

export function clearProjectScanCache(): void {
  cache.clear()
}

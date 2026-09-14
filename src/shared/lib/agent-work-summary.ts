export function summarizeChangedWork(files: string[], commitSubjects: string[] = []): string[] {
  const fromCommits = unique(
    commitSubjects.map(cleanCommitSubject).filter((line): line is string => Boolean(line))
  ).slice(0, 3)
  if (fromCommits.length > 0) return fromCommits
  return summarizeFromFiles(files).slice(0, 3)
}

function cleanCommitSubject(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) return ''
  if (/^fold /i.test(trimmed) || /^bikorch/i.test(trimmed)) return ''
  return trimmed.replace(/^(feat|fix|chore|docs|test|refactor|style|perf)(\([^)]+\))?:\s*/i, '').trim()
}

function isTestFile(file: string): boolean {
  return /(^|\/)(__tests__|tests?)\//.test(file) || /\.(test|spec)\.[^./]+$/.test(file)
}

function fileLabel(file: string): string {
  const name = file.split('/').pop() ?? file
  const stem = name.replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '')
  return stem.replace(/[-_]+/g, ' ').trim() || name
}

function summarizeFromFiles(files: string[]): string[] {
  const tests = files.filter(isTestFile)
  const rest = files.filter((file) => !isTestFile(file))
  const bullets: string[] = []
  for (const file of rest) {
    const label = fileLabel(file)
    bullets.push(`Updated ${label}`)
    if (bullets.length >= (tests.length > 0 ? 2 : 3)) break
  }
  if (tests.length === 1) {
    const label = fileLabel(tests[0])
    bullets.push(label ? `Added ${label} tests` : 'Added tests')
  } else if (tests.length > 1) {
    bullets.push('Added tests')
  }
  return unique(bullets)
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    next.push(value)
  }
  return next
}

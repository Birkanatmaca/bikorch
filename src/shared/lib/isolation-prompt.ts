import type { IsolationConflictFile } from '@shared/contracts/git'

const FALLBACK_SIDE_CHARS = 1_200
const MAX_HUNK_CHARS = 4_000

export function extractConflictHunks(
  text: string,
  options: { context?: number; maxChars?: number } = {}
): string {
  const context = options.context ?? 3
  const maxChars = options.maxChars ?? MAX_HUNK_CHARS
  const lines = text.split(/\r?\n/)
  const blocks: Array<{ start: number; end: number }> = []

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('<<<<<<<')) continue
    let end = index
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith('>>>>>>>')) {
        end = cursor
        break
      }
    }
    if (end === index) continue
    blocks.push({ start: index, end })
    index = end
  }

  if (blocks.length === 0) return ''

  const slices: string[] = []
  let consumed = 0
  for (const block of blocks) {
    const from = Math.max(consumed, block.start - context)
    const to = Math.min(lines.length - 1, block.end + context)
    if (from > consumed && consumed > 0) slices.push('…')
    slices.push(lines.slice(from, to + 1).join('\n'))
    consumed = to + 1
  }

  const joined = slices.join('\n\n')
  if (joined.length <= maxChars) return joined
  return `${joined.slice(0, maxChars)}\n…`
}

function clipSide(text: string): string {
  if (text.length <= FALLBACK_SIDE_CHARS) return text
  return `${text.slice(0, FALLBACK_SIDE_CHARS)}\n…`
}

function compactSides(file: IsolationConflictFile): string {
  const parts: string[] = []
  if (file.main) parts.push(`MAIN\n${clipSide(file.main)}`)
  if (file.agent) parts.push(`YOUR BRANCH\n${clipSide(file.agent)}`)
  return parts.join('\n\n')
}

export function buildConflictResolvePrompt(input: {
  task: string
  resolverLabel: string
  otherLabels: string[]
  files: IsolationConflictFile[]
}): string {
  const others = input.otherLabels.length > 0 ? input.otherLabels.join(', ') : 'the other agent'
  const blocks = input.files.map((file) => {
    const parts = [`File: ${file.absolutePath}`]
    if (file.hunks) {
      parts.push(file.hunks)
    } else {
      const sides = compactSides(file)
      if (sides) parts.push(sides)
    }
    return parts.join('\n\n')
  })
  return [
    `Task: ${input.task}`,
    '',
    `Conflict between ${input.resolverLabel} and ${others}.`,
    '',
    ...blocks,
    '',
    'Instructions:',
    'Resolve the merge conflict while preserving both intended changes.',
    'Edit only the conflicted files listed above (use the absolute paths).',
    'Do not modify unrelated files.',
    'Leave the files without conflict markers when you are done.'
  ].join('\n')
}

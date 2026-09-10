import type { IsolationConflictFile } from '@shared/contracts/git'

export function buildConflictResolvePrompt(input: {
  task: string
  resolverLabel: string
  otherLabels: string[]
  files: IsolationConflictFile[]
}): string {
  const others = input.otherLabels.length > 0 ? input.otherLabels.join(', ') : 'the other agent'
  const blocks = input.files.map((file) => {
    const parts = [`File: ${file.absolutePath}`]
    if (file.base) parts.push(`BASE\n${file.base}`)
    if (file.main) parts.push(`MAIN\n${file.main}`)
    if (file.agent) parts.push(`YOUR BRANCH\n${file.agent}`)
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

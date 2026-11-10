import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../Markdown'

describe('chat markdown', () => {
  it('splits an answer into blocks', () => {
    const blocks = parseMarkdown([
      '## Rebase vs merge',
      'Rebase **rewrites** history.',
      '',
      '- keeps a line',
      '- needs force push',
      '',
      '1. fetch',
      '2. rebase',
      '',
      '```bash',
      'git rebase origin/main',
      '```',
      '',
      '| Command | Effect |',
      '| --- | --- |',
      '| merge | adds a commit |',
      '',
      '> careful'
    ].join('\n'))
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'code', 'table', 'quote'])
    expect(blocks[2]).toEqual({ type: 'list', ordered: false, items: ['keeps a line', 'needs force push'] })
    expect(blocks[4]).toEqual({ type: 'code', lang: 'bash', text: 'git rebase origin/main', open: false })
    expect(blocks[5]).toEqual({ type: 'table', head: ['Command', 'Effect'], rows: [['merge', 'adds a commit']] })
  })

  it('renders a code fence that is still streaming', () => {
    expect(parseMarkdown('```ts\nconst a = 1')).toEqual([{ type: 'code', lang: 'ts', text: 'const a = 1', open: true }])
  })
})

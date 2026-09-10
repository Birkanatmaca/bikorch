import { describe, expect, it } from 'vitest'
import {
  classifyWorkCategory,
  detectFrameworkHintsFromPrompt,
  detectLanguageHints,
  languageCensusFromFiles
} from '../classification'

describe('classifyWorkCategory', () => {
  it('returns undefined for empty input', () => {
    expect(classifyWorkCategory('   ')).toBeUndefined()
  })

  it('detects debugging', () => {
    expect(classifyWorkCategory('The app crashes with a null pointer error when I open the panel, please fix it')).toBe('Debugging')
  })

  it('detects testing', () => {
    expect(classifyWorkCategory('Write vitest unit tests for the redaction module with good coverage')).toBe('Testing')
  })

  it('detects refactoring', () => {
    expect(classifyWorkCategory('Refactor this function and extract the helpers, then rename the file')).toBe('Refactoring')
  })

  it('detects devops', () => {
    expect(classifyWorkCategory('Create a Dockerfile and a GitHub Actions pipeline to deploy the service')).toBe('DevOps')
  })

  it('detects documentation and code review', () => {
    expect(classifyWorkCategory('Update the README and add a changelog entry')).toBe('Documentation')
    expect(classifyWorkCategory('Review this pull request for code smells')).toBe('Code review')
  })

  it('classifies feature work and leaves unmatched text unclassified', () => {
    expect(classifyWorkCategory('Add a dark mode toggle to the settings page')).toBe('Feature development')
    expect(classifyWorkCategory('lorem ipsum dolor sit amet')).toBeUndefined()
  })

  it('understands turkish keywords', () => {
    expect(classifyWorkCategory('Bu hata neden çalışmıyor, düzelt')).toBe('Debugging')
  })
})

describe('detectLanguageHints', () => {
  it('reads fenced code block tags', () => {
    expect(detectLanguageHints('Fix this:\n```ts\nconst a = 1\n```')).toEqual(['typescript'])
    expect(detectLanguageHints('```python\nprint(1)\n```\n```go\nfunc main(){}\n```')).toEqual(['go', 'python'])
  })

  it('reads file names with known extensions', () => {
    expect(detectLanguageHints('Update src/main/index.ts and server.go')).toEqual(['go', 'typescript'])
  })

  it('ignores version numbers and non-code files', () => {
    expect(detectLanguageHints('Bump to 1.2.3 and edit README.md plus config.json')).toEqual([])
  })
})

describe('languageCensusFromFiles', () => {
  it('counts files by detected language and skips non-code files', () => {
    expect(languageCensusFromFiles(['a.ts', 'b.tsx', 'c.go', 'LICENSE', 'package.json'])).toEqual({
      typescript: 2,
      go: 1
    })
  })
})

describe('detectFrameworkHintsFromPrompt', () => {
  it('matches known frameworks by keyword', () => {
    const hints = detectFrameworkHintsFromPrompt('Add an Electron IPC handler and a React hook using Tailwind')
    expect(hints).toEqual(expect.arrayContaining(['React', 'Electron', 'Tailwind CSS']))
  })

  it('returns an empty list when nothing matches', () => {
    expect(detectFrameworkHintsFromPrompt('rename the variable')).toEqual([])
  })
})

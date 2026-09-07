import { describe, expect, it } from 'vitest'
import { isLikelyPrompt, PromptComposer } from '../prompt-capture'

function type(composer: PromptComposer, text: string): string[] {
  const submitted: string[] = []
  for (const char of text) submitted.push(...composer.feed(char))
  return submitted
}

describe('isLikelyPrompt', () => {
  it('drops menu answers, slash commands and numbers', () => {
    expect(isLikelyPrompt('y')).toBe(false)
    expect(isLikelyPrompt('yes')).toBe(false)
    expect(isLikelyPrompt('2')).toBe(false)
    expect(isLikelyPrompt('/help')).toBe(false)
    expect(isLikelyPrompt('/compact')).toBe(false)
    expect(isLikelyPrompt('')).toBe(false)
  })

  it('keeps real prompts, including slash commands with arguments', () => {
    expect(isLikelyPrompt('fix the failing test')).toBe(true)
    expect(isLikelyPrompt('/review src/main')).toBe(true)
    expect(isLikelyPrompt('hata neden oluyor')).toBe(true)
  })
})

describe('PromptComposer', () => {
  it('captures a typed line when Enter is pressed', () => {
    const composer = new PromptComposer()
    expect(type(composer, 'add a loading state')).toEqual([])
    expect(composer.feed('\r')).toEqual(['add a loading state'])
    expect(composer.peek()).toBe('')
  })

  it('applies backspace, ctrl+w and ctrl+u edits', () => {
    const composer = new PromptComposer()
    type(composer, 'fix the bugz')
    composer.feed('\u007f')
    type(composer, ' now')
    expect(composer.peek()).toBe('fix the bug now')
    composer.feed('\u0017') // delete word
    expect(composer.peek()).toBe('fix the bug ')
    composer.feed('\u0015') // clear line
    expect(composer.peek()).toBe('')
  })

  it('ignores cursor movement escape sequences but honours left/right edits', () => {
    const composer = new PromptComposer()
    type(composer, 'ac')
    composer.feed('\u001b[D') // left
    type(composer, 'b')
    expect(composer.peek()).toBe('abc')
    composer.feed('\u001b[C') // right
    type(composer, 'd')
    expect(composer.feed('\r')).toEqual(['abcd'])
  })

  it('handles escape sequences split across chunks', () => {
    const composer = new PromptComposer()
    type(composer, 'hello world')
    composer.feed('\u001b[')
    composer.feed('H') // home
    type(composer, 'oh ')
    expect(composer.peek()).toBe('oh hello world')
  })

  it('treats bracketed paste as content, including newlines', () => {
    const composer = new PromptComposer()
    composer.feed('\u001b[200~line one\r\nline two\u001b[201~')
    expect(composer.peek()).toBe('line one\nline two')
    expect(composer.feed('\r')).toEqual(['line one\nline two'])
  })

  it('handles a paste terminator arriving in a later chunk', () => {
    const composer = new PromptComposer()
    composer.feed('\u001b[200~first part ')
    composer.feed('second part\u001b[201')
    composer.feed('~')
    expect(composer.peek()).toBe('first part second part')
  })

  it('does not submit on newlines inside a multi-character chunk', () => {
    const composer = new PromptComposer()
    expect(composer.feed('explain this\nand that')).toEqual([])
    expect(composer.feed('\r')).toEqual(['explain this\nand that'])
  })

  it('discards history recall so unseen recalled prompts are not misattributed', () => {
    const composer = new PromptComposer()
    type(composer, 'partial')
    composer.feed('\u001b[A') // up arrow
    expect(composer.feed('\r')).toEqual([])
    type(composer, 'typed after recall')
    expect(composer.feed('\r')).toEqual(['typed after recall'])
  })

  it('resets on ctrl+c and skips non-prompt answers', () => {
    const composer = new PromptComposer()
    type(composer, 'something')
    composer.feed('\u0003')
    expect(composer.peek()).toBe('')
    type(composer, 'y')
    expect(composer.feed('\r')).toEqual([])
    type(composer, '/help')
    expect(composer.feed('\r')).toEqual([])
  })

  it('inserts a soft newline for alt+enter and shift+enter', () => {
    const composer = new PromptComposer()
    type(composer, 'first')
    composer.feed('\u001b\r')
    type(composer, 'second')
    composer.feed('\u001b[13;2u')
    type(composer, 'third')
    expect(composer.feed('\r')).toEqual(['first\nsecond\nthird'])
  })
})

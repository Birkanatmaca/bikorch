import { Fragment, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * A small Markdown renderer for Claude's answers: headings, paragraphs,
 * lists, quotes, tables, fenced code and inline code/bold/italic/links.
 * It builds React elements only (no HTML injection), and links are http(s).
 */

type Block =
  | { type: 'code'; lang: string; text: string; open: boolean }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'rule' }
  | { type: 'paragraph'; text: string }

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        body.push(lines[index])
        index += 1
      }
      const open = index >= lines.length
      index += 1
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n'), open })
      continue
    }
    if (!line.trim()) {
      index += 1
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      index += 1
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }
    if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(cells(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }
    const listMatch = /^\s*([-*+]|\d+[.)])\s+/.exec(line)
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1])
      const items: string[] = []
      while (index < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index])
        if (item && /\d/.test(item[1]) === ordered) {
          items.push(item[2])
        } else if (lines[index].trim() && /^\s{2,}/.test(lines[index]) && items.length > 0) {
          items[items.length - 1] += ` ${lines[index].trim()}`
        } else {
          break
        }
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', text: quote.join(' ') })
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*(```|~~~|#{1,4}\s|>|([-*+]|\d+[.)])\s+)/.test(lines[index])
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
  }
  return blocks
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\*[^*\s\n][^*\n]*\*|_[^_\s\n][^_\n]*_)/g

function Inline({ text }: { text: string }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const [whole, code, bold, , label, href, bare, italic] = match
    if (code) parts.push(<code key={key++} className="md-code">{code.slice(1, -1)}</code>)
    else if (bold) parts.push(<strong key={key++}><Inline text={bold.slice(2, -2)} /></strong>)
    else if (label && href) parts.push(<a key={key++} href={href} target="_blank" rel="noreferrer noopener">{label}</a>)
    else if (bare) parts.push(<a key={key++} href={bare} target="_blank" rel="noreferrer noopener">{bare}</a>)
    else if (italic) parts.push(<em key={key++}>{italic.slice(1, -1)}</em>)
    else parts.push(whole)
    last = at + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts.map((part, index) => (typeof part === 'string' ? <Fragment key={`t${index}`}>{withBreaks(part)}</Fragment> : part))}</>
}

function withBreaks(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, index) => (
    <Fragment key={index}>{line}{index < lines.length - 1 && <br />}</Fragment>
  ))
}

function CodeBlock({ lang, text }: { lang: string; text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-pre">
      <div className="md-pre-head">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            })
          }}
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  )
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = parseMarkdown(text)
  return (
    <div className="md">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'code':
            return <CodeBlock key={index} lang={block.lang} text={block.text} />
          case 'heading':
            return block.level <= 2
              ? <h3 key={index}><Inline text={block.text} /></h3>
              : <h4 key={index}><Inline text={block.text} /></h4>
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return <Tag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}</Tag>
          }
          case 'quote':
            return <blockquote key={index}><Inline text={block.text} /></blockquote>
          case 'table':
            return (
              <div key={index} className="md-table">
                <table>
                  <thead><tr>{block.head.map((cell, cellIndex) => <th key={cellIndex}><Inline text={cell} /></th>)}</tr></thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline text={cell} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'rule':
            return <hr key={index} />
          case 'paragraph':
            return <p key={index}><Inline text={block.text} /></p>
        }
      })}
    </div>
  )
}

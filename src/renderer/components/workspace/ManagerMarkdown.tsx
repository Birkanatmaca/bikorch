import { Fragment, type ReactNode } from 'react'

function inlineText(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g
  let offset = 0
  let match: RegExpExecArray | null
  while ((match = tokens.exec(text))) {
    if (match.index > offset) nodes.push(text.slice(offset, match.index))
    const token = match[0]
    const key = `token-${match.index}`
    if (token.startsWith('`')) {
      nodes.push(<code key={key} className="manager-inline-code">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const separator = token.indexOf('](')
      const label = token.slice(1, separator)
      const href = token.slice(separator + 2, -1)
      let safe = false
      try {
        const url = new URL(href)
        safe = (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      } catch { /* Relative file references remain readable text. */ }
      nodes.push(safe
        ? <a key={key} className="manager-link" href={href} target="_blank" rel="noreferrer noopener">{label}</a>
        : <span key={key}>{label} ({href})</span>)
    }
    offset = match.index + token.length
  }
  if (offset < text.length) nodes.push(text.slice(offset))
  return nodes
}

function paragraphLines(lines: string[]): ReactNode[] {
  return lines.map((line, index) => <Fragment key={index}>{index > 0 ? <br /> : null}{inlineText(line)}</Fragment>)
}

/** Render common developer chat formatting as React nodes; never interpret raw HTML. */
export function ManagerMarkdown({ content }: { content: string }): React.JSX.Element {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const start = index
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^\s]*)/)
    if (fence) {
      const code: string[] = []
      index++
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) code.push(lines[index++])
      if (index < lines.length) index++
      blocks.push(
        <div key={start} className="manager-message-code">
          {fence[2] ? <span>{fence[2]}</span> : null}
          <pre><code>{code.join('\n')}</code></pre>
        </div>
      )
      continue
    }
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (heading) {
      blocks.push(<h3 key={start}>{inlineText(heading[1])}</h3>)
      index++
      continue
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={start} />)
      index++
      continue
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/)
    if (list) {
      const ordered = Boolean(list[2])
      const entries: ReactNode[] = []
      while (index < lines.length) {
        const entry = lines[index].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/)
        if (!entry || Boolean(entry[2]) !== ordered) break
        entries.push(<li key={index}>{inlineText(entry[3])}</li>)
        index++
      }
      blocks.push(ordered ? <ol key={start} start={Number(list[2])}>{entries}</ol> : <ul key={start}>{entries}</ul>)
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''))
      blocks.push(<blockquote key={start}>{paragraphLines(quote)}</blockquote>)
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && /^\s*(?:#{1,6}\s|`{3,}|~{3,}|>\s?|[-*+]\s|\d+[.)]\s|---+$|\*\*\*+$|___+$)/.test(lines[index])) break
      paragraph.push(lines[index++])
    }
    blocks.push(<p key={start}>{paragraphLines(paragraph)}</p>)
  }
  return <div className="manager-message-content">{blocks}</div>
}

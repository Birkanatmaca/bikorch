import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

describe('startup graph', () => {
  it('does not import Monaco from the renderer entry or App shell', () => {
    const entry = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8')
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
    expect(entry).not.toMatch(/monaco/i)
    expect(app).not.toMatch(/from '@renderer\/lib\/monaco'/)
    expect(app).not.toMatch(/from '@monaco-editor\/react'/)
    expect(app).toMatch(/lazy\(\(\) =>/)
    expect(app).toMatch(/IdeOverlay/)
  })
})

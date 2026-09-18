import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSecretaryProjectContext } from '../context-service'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Secretary project context', () => {
  it('collects a bounded redacted summary without exposing sensitive files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bikorch-secretary-context-'))
    workspaces.push(root)
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'node_modules', 'ignored-package'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'context-fixture',
      scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' }
    }))
    await writeFile(join(root, 'AGENTS.md'), 'Use the project conventions. OPENAI_API_KEY=sk-proj-secret-value-1234567890')
    await writeFile(join(root, '.env'), 'DATABASE_PASSWORD=do-not-share')
    await writeFile(join(root, 'src', 'app.ts'), 'export const ready = true')
    await writeFile(join(root, 'node_modules', 'ignored-package', 'index.js'), 'ignored')

    const context = await buildSecretaryProjectContext({
      id: 'project-1234',
      name: 'Context fixture',
      folderPath: root
    })

    expect(context.project).toMatchObject({ id: 'project-1234', name: 'Context fixture', available: true })
    expect(context.stack).toMatchObject({ packageManager: null, packageName: 'context-fixture', scripts: ['test', 'typecheck'] })
    expect(context.tree).toContainEqual({ path: 'src/app.ts', kind: 'file' })
    expect(context.tree.some((entry) => entry.path.includes('.env') || entry.path.includes('node_modules'))).toBe(false)
    expect(context.instructions[0]?.content).toContain('[REDACTED]')
    expect(JSON.stringify(context)).not.toContain(root)
  })

  it('returns a safe empty context when the project folder is unavailable', async () => {
    const context = await buildSecretaryProjectContext({
      id: 'project-1234',
      name: 'Missing project',
      folderPath: join(tmpdir(), 'bikorch-no-such-project')
    })

    expect(context.project.available).toBe(false)
    expect(context.tree).toEqual([])
    expect(context.warnings).toHaveLength(1)
  })
})

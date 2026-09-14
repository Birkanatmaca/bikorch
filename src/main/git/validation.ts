import { spawn } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { IsolationValidation, IsolationValidationResult } from '@shared/contracts/git'
import { pathExists } from './git-exec'

const TIMEOUT_MS = 20_000

function summarize(ok: boolean, output: string, skipped = false): IsolationValidationResult {
  const compact = output.replace(/\s+/g, ' ').trim().slice(0, 240)
  return { ok, skipped, summary: compact || (ok ? 'passed' : 'failed') }
}

function runScript(cwd: string, script: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script, '--if-present'], {
      cwd,
      windowsHide: true,
      env: { ...process.env, CI: '1', npm_config_progress: 'false' }
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, output: output || `timed out running ${script}` })
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output })
    })
  })
}

export async function runIsolationValidation(cwd: string): Promise<IsolationValidation> {
  const ranAt = Date.now()
  const pkgPath = join(cwd, 'package.json')
  if (!(await pathExists(pkgPath))) {
    return { ranAt, typecheck: summarize(true, 'no package.json', true) }
  }
  let scripts: Record<string, string> = {}
  try {
    const parsed = JSON.parse(await readFile(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    scripts = parsed.scripts ?? {}
  } catch {
    return { ranAt, typecheck: summarize(true, 'package.json unreadable', true) }
  }

  const typecheckName = ['typecheck', 'type-check'].find((name) => scripts[name])
  const testName =
    scripts.test && !/\bwatch\b/i.test(scripts.test) && !/\bvitest\s*$/i.test(scripts.test.trim())
      ? 'test'
      : undefined
  const buildName = scripts.build && !/\bwatch\b/i.test(scripts.build) ? 'build' : undefined

  const validation: IsolationValidation = { ranAt }
  if (typecheckName) {
    const result = await runScript(cwd, typecheckName)
    validation.typecheck = summarize(result.ok, result.output)
  } else {
    validation.typecheck = summarize(true, 'no typecheck script', true)
  }
  if (testName) {
    const result = await runScript(cwd, testName)
    validation.test = summarize(result.ok, result.output)
  }
  if (buildName) {
    const result = await runScript(cwd, buildName)
    validation.build = summarize(result.ok, result.output)
  }
  return validation
}

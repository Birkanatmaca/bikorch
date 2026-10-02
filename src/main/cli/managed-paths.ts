import { homedir } from 'os'
import { join } from 'path'

// Per-user tools also work without system Node/npm or admin rights.
export function managedCliPaths(kind?: 'gemini' | 'codex') {
  const root = join(homedir(), '.bikorch', 'cli')
  const runtime = join(root, 'node')
  const prefix = kind ? join(root, 'packages', kind) : join(root, 'packages')
  const windows = process.platform === 'win32'
  return {
    root,
    runtime,
    prefix,
    nodeBin: windows ? runtime : join(runtime, 'bin'),
    node: windows ? join(runtime, 'node.exe') : join(runtime, 'bin', 'node'),
    npm: windows
      ? join(runtime, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : join(runtime, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    packageBin: windows ? prefix : join(prefix, 'bin')
  }
}

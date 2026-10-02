import type { SpawnConfig } from './adapters'

export function appendCliArgs(config: SpawnConfig, extra: string[]): string[] {
  const args = [...config.args]
  const commandIndex = args.findIndex((arg) => arg.toLowerCase() === '/c')
  if (/cmd(?:\.exe)?$/i.test(config.command) && commandIndex >= 0) {
    const quoted = extra.map((arg) => /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)
    args[commandIndex + 1] = [args[commandIndex + 1], ...quoted].join(' ')
    return args
  }
  return [...args, ...extra]
}

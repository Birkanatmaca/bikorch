import { CLI_MANAGER_PROVIDER_UNAVAILABLE } from '@shared/contracts/secretary'
import type { CliUsageKind } from '@shared/contracts/usage'
import { cliManagerSupportsKind } from './cli-manager-launch'
import type { ManagerAiProvider, ManagerModelMessage } from './manager-ai-provider'
import type { SecretaryResponseFormat } from './response-schema'

export interface ManagerCliSettings {
  kind: CliUsageKind | null
  accountId: string | null
  model: string | null
}

export interface ManagerCliRunner {
  generate(input: {
    kind: CliUsageKind
    accountId: string
    model: string | null
    messages: ManagerModelMessage[]
    format: SecretaryResponseFormat
  }): Promise<string>
}

export function createCliManagerProvider(dependencies?: {
  settings: () => ManagerCliSettings
  runner: ManagerCliRunner
}): ManagerAiProvider {
  return {
    async generate(input, format) {
      const settings = dependencies?.settings()
      if (!dependencies || !settings?.kind || !settings.accountId || !cliManagerSupportsKind(settings.kind)) {
        throw new Error(CLI_MANAGER_PROVIDER_UNAVAILABLE)
      }
      return dependencies.runner.generate({
        kind: settings.kind,
        accountId: settings.accountId,
        model: settings.model,
        messages: input,
        format
      })
    }
  }
}

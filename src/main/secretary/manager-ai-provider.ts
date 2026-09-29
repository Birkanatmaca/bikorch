import type { SecretaryResponseUsage } from './pricing'
import type { SecretaryResponseFormat } from './response-schema'
import { extractResponseText } from './response-text'
import {
  SECRETARY_MAX_REQUEST_ATTEMPTS,
  SECRETARY_REQUEST_TIMEOUT_MS,
  isRetryableSecretaryStatus,
  secretaryNetworkError,
  secretaryRequestError
} from './request-policy'

export type ManagerModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: Array<{ type: 'input_text'; text: string }>
}

/** Conversation logic depends on this normalized interface, not a transport. */
export interface ManagerAiProvider {
  generate(input: ManagerModelMessage[], format: SecretaryResponseFormat): Promise<string>
}

export function createOpenAiManagerProvider(dependencies: {
  apiKey: () => string | null
  model: () => string
  recordUsage: (model: string, usage: SecretaryResponseUsage | undefined) => void
}): ManagerAiProvider {
  return {
    async generate(input, format) {
      const apiKey = dependencies.apiKey()
      if (!apiKey) throw new Error('Add an OpenAI API key in Manager settings first')
      const model = dependencies.model()
      const body = JSON.stringify({
        model,
        store: false,
        input,
        text: { format: { type: 'json_schema', name: format.name, strict: true, schema: format.schema } }
      })
      let lastNetworkError: Error | null = null
      for (let attempt = 1; attempt <= SECRETARY_MAX_REQUEST_ATTEMPTS; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), SECRETARY_REQUEST_TIMEOUT_MS)
        try {
          const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body,
            signal: controller.signal
          })
          if (!response.ok) {
            let detail: string | undefined
            try {
              const payload = await response.json() as { error?: { message?: unknown }; message?: unknown }
              const message = payload?.error?.message ?? payload?.message
              if (typeof message === 'string') detail = message
            } catch {
              // A gateway can return an empty or non-JSON error body.
            }
            const error = secretaryRequestError(response.status, detail)
            if (attempt < SECRETARY_MAX_REQUEST_ATTEMPTS && isRetryableSecretaryStatus(response.status)) {
              await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * attempt, 2_000)))
              continue
            }
            throw error
          }
          const result = await response.json() as { usage?: SecretaryResponseUsage }
          dependencies.recordUsage(model, result.usage)
          const text = extractResponseText(result)
          if (!text) throw new Error('The Manager returned no structured result.')
          return text
        } catch (cause) {
          const timedOut = controller.signal.aborted
          const error = cause instanceof Error && !timedOut && cause.message.startsWith('The Manager ')
            ? cause
            : secretaryNetworkError(timedOut)
          if (attempt < SECRETARY_MAX_REQUEST_ATTEMPTS && (timedOut || !(cause instanceof Error) || cause.name === 'TypeError')) {
            lastNetworkError = error
            await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * attempt, 2_000)))
            continue
          }
          throw error
        } finally {
          clearTimeout(timeout)
        }
      }
      throw lastNetworkError ?? new Error('The Manager request could not be completed.')
    }
  }
}

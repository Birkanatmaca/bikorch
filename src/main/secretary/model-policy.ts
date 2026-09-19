export const DEFAULT_SECRETARY_MODEL = 'gpt-5'

export function isValidSecretaryModelId(model: string): boolean {
  return /^[a-zA-Z0-9._-]{2,100}$/.test(model.trim())
}

export function resolveSecretaryModel(savedModel: string | null | undefined): string {
  const model = savedModel?.trim()
  if (!model || !isValidSecretaryModelId(model)) {
    return DEFAULT_SECRETARY_MODEL
  }
  return model
}

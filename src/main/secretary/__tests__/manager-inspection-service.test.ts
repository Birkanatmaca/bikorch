import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretaryRun } from '@shared/contracts/secretary'
import type { SecretaryCliResult } from '../service'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(), getSecretaryStore: vi.fn(), buildSecretaryProjectContext: vi.fn(), saveManagerSkills: vi.fn(), flush: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/test/user-data', getLocale: () => 'tr-TR' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../persistence/database', () => ({
  readMetaValue: () => null, writeMetaValue: vi.fn(), flushPersistenceToDisk: mocks.flush, listPersistedAiAccounts: () => []
}))
vi.mock('../manager-ai-provider', () => ({
  createOpenAiManagerProvider: () => ({ generate: mocks.generate }),
  resolveManagerAiProvider: (input: { api: unknown }) => input.api
}))
vi.mock('../cli-manager-session', () => ({ createManagerCliRunner: () => ({}) }))
vi.mock('../cli-manager-provider', () => ({ createCliManagerProvider: () => ({}) }))
vi.mock('../store', () => ({ getSecretaryStore: mocks.getSecretaryStore, messagesToChatTurns: () => [] }))
vi.mock('../context-service', () => ({ buildSecretaryProjectContext: mocks.buildSecretaryProjectContext }))
vi.mock('../memory-context', () => ({ secretaryMemoryContext: () => [] }))
vi.mock('../skill-context', () => ({ secretarySkillContext: () => [], saveManagerSkills: mocks.saveManagerSkills }))

import { chatWithSecretary, finalizeSecretaryRun } from '../service'

const project = { id: 'project-1234', name: 'Bikorch', folderPath: '/workspace' }
const run: SecretaryRun = {
  id: 'run-123456', threadId: 'thread-1234', projectId: project.id, status: 'running', requestText: 'Hata nedenini incele',
  reply: null, plan: null, planRevision: 1, openKinds: [], errorCode: null, errorMessage: null, sessionBindings: [], evidence: null,
  createdAt: 1, updatedAt: 1
}
const failedResult: SecretaryCliResult = {
  assignmentId: 'assignment-1', kind: 'cursor', mode: 'validate', title: 'Validate app', expectedResult: 'Build succeeds',
  summary: 'Build failed', output: '\u001b[31mTypeError: undefined state\u001b[0m\nTOKEN=private-token-value', outcome: 'failed', completionEvidence: 'cli-reported',
  git: { available: true, changedFiles: [], commits: [], preexistingChangedFiles: [], reportedChangedFiles: [], unverifiedReportedFiles: [], patchCheckExitCode: 0 }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSecretaryStore.mockReturnValue(null)
  mocks.buildSecretaryProjectContext.mockResolvedValue({ sourceExcerpts: [{ path: 'src/app.ts', startLine: 1, content: 'code' }], terminalFailures: [] })
  mocks.saveManagerSkills.mockReturnValue([])
  mocks.generate.mockResolvedValue(JSON.stringify({ reply: 'İncelendi.', plan: null, openKinds: [], skills: [], actions: [] }))
})

describe('Manager read-only inspection turns', () => {
  it.each(['project-review', 'error-diagnosis'] as const)('enforces %s even if the model proposes execution and skill mutation', async (purpose) => {
    mocks.generate.mockResolvedValue(JSON.stringify({
      reply: 'TypeError: undefined state. TOKEN=private-token-value',
      plan: { invalid: 'this plan must never be validated or dispatched' }, openKinds: ['cursor'],
      skills: [{ name: 'Unexpected', instructions: 'Save this' }], actions: ['open-terminal', 'show-files']
    }))
    const response = await chatWithSecretary({ project, message: 'Projeyi analiz et ve skill oluştur', purpose, panels: [], usage: [] })
    expect(response).toMatchObject({ plan: null, openKinds: [] })
    expect(response.actions).toBeUndefined()
    expect(response.savedSkills).toBeUndefined()
    expect(response.reply).not.toContain('private-token-value')
    expect(mocks.saveManagerSkills).not.toHaveBeenCalled()
    const input = mocks.generate.mock.calls[0][0]
    expect(input[0].content[0].text).toContain('read-only inspection purpose')
    expect(JSON.parse(input[1].content[0].text)).toMatchObject({ inspectionPurpose: purpose, canOpenPanels: false })
    expect(mocks.buildSecretaryProjectContext).toHaveBeenCalledWith(project, expect.any(String))
  })

  it('rejects unsupported purposes before contacting the model', async () => {
    await expect(chatWithSecretary({ project, message: 'Review', purpose: 'execute', panels: [], usage: [] })).rejects.toThrow('Invalid Manager inspection purpose')
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('keeps ordinary chat app actions available', async () => {
    mocks.generate.mockResolvedValue(JSON.stringify({ reply: 'Dosyaları açıyorum.', plan: null, openKinds: [], skills: [], actions: ['show-files'] }))
    await expect(chatWithSecretary({ project, message: 'Dosyaları göster', panels: [], usage: [] })).resolves.toMatchObject({ actions: ['show-files'] })
  })
})

describe('Manager failed-work reporting', () => {
  it('sends redacted failure evidence to Manager and persists a failed run with its report', async () => {
    const saved = { ...run }
    const updateRun = vi.fn((_id: string, patch: Partial<SecretaryRun>) => Object.assign(saved, patch))
    const appendMessage = vi.fn()
    mocks.getSecretaryStore.mockReturnValue({
      getRun: () => saved, getThreadContextSummary: () => '', countFollowUpRuns: () => 0, updateRun, appendMessage
    })
    mocks.generate.mockResolvedValue(JSON.stringify({ reply: 'Derleme state tanımsız olduğu için durdu. src/app.ts girişini kontrol et.', plan: { invalid: 'must be ignored on failure' } }))
    const result = await finalizeSecretaryRun(run.id, [failedResult], [{ id: 'assignment-2', title: 'Review result', failedDependencies: ['assignment-1'] }])
    expect(result.completedRun).toMatchObject({ status: 'failed', errorCode: 'CLI_ASSIGNMENT_FAILED' })
    expect(result.followUpRun).toBeNull()
    expect(appendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'final-report', content: expect.stringContaining('state tanımsız') }))
    const context = JSON.parse(mocks.generate.mock.calls[0][0][1].content[0].text)
    expect(context.cliResults[0].errorEvidence).toContain('TypeError')
    expect(context.cliResults[0].errorEvidence).toContain('[REDACTED]')
    expect(context.skippedAssignments).toEqual([{ id: 'assignment-2', title: 'Review result', failedDependencies: ['assignment-1'] }])
    expect(JSON.stringify(context)).not.toContain('private-token-value')
    expect(JSON.stringify(context)).not.toContain('\u001b')
  })
})

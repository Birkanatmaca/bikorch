import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import {
  DASHBOARD_IPC,
  type HomeChatEvent,
  type HomeChatImage,
  type HomeChatMessage,
  type HomeChatState
} from '@shared/contracts/dashboard'
import { readMetaValue, writeMetaValue } from '../persistence/database'
import { resolveSpawnConfigCandidates } from '../cli/adapters'
import { recordLog } from '../logs'
import { claudeEnv } from './briefing'
import {
  HOME_CHAT_KEEP,
  IMAGE_ID,
  chatFailureMessage,
  chatInputLine,
  imageFileName,
  parseStoredChat,
  readChatStreamLine,
  splitLines,
  validateChatInput
} from './home-chat-stream'

/**
 * The Home "Ask Claude" chat. Each question runs `claude -p` headless with
 * only web tools; the conversation continues through one Claude session id
 * (--session-id, then --resume), so follow-ups keep their context.
 */

const META_KEY = 'home_chat'
const ANSWER_TIMEOUT_MS = 5 * 60 * 1000

const SYSTEM_PROMPT = [
  'You are Claude, a general assistant in the Home screen chat of Bikorch, a desktop app.',
  'The user may ask about anything: everyday questions, health, money, travel, writing, language, math, science, news, as well as software.',
  'Answer the question that was asked, directly and helpfully; do not steer toward programming unless the question is about it.',
  'Use Markdown where it helps: short paragraphs, lists, tables, and fenced code blocks with a language tag for code.',
  "Reply in the language of the user's latest message.",
  'Search the web when the answer depends on current or local facts (news, prices, schedules, weather, recent releases) and link the pages you used.',
  'The user may attach screenshots, photos or documents as images; read them closely and refer to what you see.',
  'Here you cannot see or change files on this computer or run commands. If a question needs that, say so briefly.'
].join(' ')

let sessionId: string | null = null
let messages: HomeChatMessage[] = []
let loaded = false
let child: ChildProcess | null = null
let streaming: string | null = null
let activity: string | null = null
let error: string | null = null
let stopRequested = false

const chatFolder = (): string => join(app.getPath('userData'), 'home-chat')
const imageFolder = (): string => join(chatFolder(), 'images')

function load(): void {
  if (loaded) return
  loaded = true
  const stored = parseStoredChat(readMetaValue(META_KEY))
  sessionId = stored.sessionId
  messages = stored.messages
}

function save(): void {
  writeMetaValue(META_KEY, JSON.stringify({ sessionId, messages: messages.slice(-HOME_CHAT_KEEP) }))
}

export function getHomeChatState(): HomeChatState {
  load()
  return { messages, streaming, activity, error }
}

function emit(event: HomeChatEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(DASHBOARD_IPC.CHAT_EVENT, event)
  }
}

const emitState = (): void => emit({ type: 'state', state: getHomeChatState() })

function finish(text: string, incomplete: boolean, failure: string | null): void {
  const answer = text.trim()
  if (answer) {
    messages = [...messages, { id: randomUUID(), role: 'assistant', text: answer, at: Date.now(), ...(incomplete ? { incomplete: true } : {}) }]
  }
  child = null
  streaming = null
  activity = null
  error = failure
  save()
  emitState()
}

export async function sendHomeChat(raw: unknown): Promise<HomeChatState> {
  load()
  if (child) throw new Error('Claude is still answering')
  const valid = validateChatInput(raw)
  if (!valid.ok) throw new Error(valid.error)
  const { text: question, images } = valid.input
  const claude = resolveSpawnConfigCandidates('claude')[0]
  if (!claude) {
    error = 'Install Claude Code to chat here.'
    emitState()
    return getHomeChatState()
  }

  // Images are kept so the conversation still shows them after a restart.
  const stored: HomeChatImage[] = []
  if (images.length > 0) {
    mkdirSync(imageFolder(), { recursive: true })
    for (const image of images) {
      const entry: HomeChatImage = { id: randomUUID(), name: image.name, mediaType: image.mediaType }
      writeFileSync(join(imageFolder(), imageFileName(entry)), image.bytes, { mode: 0o600 })
      stored.push(entry)
    }
  }

  const resuming = sessionId !== null
  if (!sessionId) sessionId = randomUUID()
  messages = [...messages, { id: randomUUID(), role: 'user', text: question, at: Date.now(), ...(stored.length > 0 ? { images: stored } : {}) }]
  streaming = ''
  activity = 'Thinking'
  error = null
  stopRequested = false
  save()
  emitState()

  const workspace = chatFolder()
  mkdirSync(workspace, { recursive: true })
  const args = [
    ...claude.args,
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(resuming ? ['--resume', sessionId] : ['--session-id', sessionId]),
    '--strict-mcp-config',
    '--append-system-prompt', SYSTEM_PROMPT,
    '--tools', 'WebSearch', 'WebFetch',
    '--allowedTools', 'WebSearch', 'WebFetch'
  ]

  const env = { ...(await claudeEnv()), ...(claude.env ?? {}) }
  const process_ = spawn(claude.command, args, { cwd: workspace, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  child = process_
  let buffer = ''
  let stderr = ''
  let result: { text: string; isError: boolean } | null = null
  const timer = setTimeout(() => process_.kill('SIGTERM'), ANSWER_TIMEOUT_MS)

  process_.stdout.setEncoding('utf8')
  process_.stderr.setEncoding('utf8')
  process_.stdout.on('data', (chunk: string) => {
    const { lines, rest } = splitLines(buffer + chunk)
    buffer = rest
    for (const line of lines) {
      const signal = readChatStreamLine(line)
      if (!signal) continue
      if (signal.kind === 'delta') {
        streaming = (streaming ?? '') + signal.text
        if (activity) {
          activity = null
          emit({ type: 'activity', activity: null })
        }
        emit({ type: 'delta', text: signal.text })
      } else if (signal.kind === 'activity') {
        // Once text flows, only a tool call is worth announcing again.
        if (signal.activity === activity || (streaming && signal.activity === 'Thinking')) continue
        activity = signal.activity
        emit({ type: 'activity', activity })
      } else {
        result = signal
      }
    }
  })
  process_.stderr.on('data', (chunk: string) => {
    if (stderr.length < 20_000) stderr += chunk
  })
  process_.on('error', (cause) => {
    clearTimeout(timer)
    recordLog('warn', `Home chat could not start Claude: ${cause.message}`, 'dashboard')
    finish(streaming ?? '', true, 'Could not run Claude Code.')
  })
  process_.on('close', (code) => {
    clearTimeout(timer)
    if (child !== process_) return
    const tail = buffer.trim() ? readChatStreamLine(buffer) : null
    if (tail?.kind === 'result') result = tail
    const final = result as { text: string; isError: boolean } | null
    if (stopRequested) {
      finish(streaming ?? '', true, null)
      return
    }
    if (final && !final.isError) {
      finish(final.text || streaming || '', false, null)
      return
    }
    const detail = `${stderr}\n${final?.text ?? ''}`
    recordLog('warn', `Home chat failed (exit ${code}): ${detail.trim().slice(0, 300)}`, 'dashboard')
    // A session Claude no longer knows starts over on the next question.
    if (/no conversation found|session.*not found/i.test(detail)) sessionId = null
    finish(streaming ?? '', true, chatFailureMessage(detail))
  })

  process_.stdin.on('error', () => undefined)
  process_.stdin.end(chatInputLine(question, images))
  return getHomeChatState()
}

export function stopHomeChat(): HomeChatState {
  if (child) {
    stopRequested = true
    child.kill('SIGTERM')
  }
  return getHomeChatState()
}

/** Forgets the conversation; the next question starts a new Claude session. */
export function resetHomeChat(): HomeChatState {
  load()
  if (child) {
    stopRequested = true
    child.kill('SIGTERM')
    child = null
  }
  sessionId = null
  messages = []
  rmSync(imageFolder(), { recursive: true, force: true })
  streaming = null
  activity = null
  error = null
  save()
  emitState()
  return getHomeChatState()
}

/** An attached image as a data URL, for showing it in the conversation. */
export function getHomeChatImage(id: unknown): string | null {
  load()
  if (typeof id !== 'string' || !IMAGE_ID.test(id)) return null
  const image = messages.flatMap((message) => message.images ?? []).find((entry) => entry.id === id)
  if (!image) return null
  try {
    return `data:${image.mediaType};base64,${readFileSync(join(imageFolder(), imageFileName(image))).toString('base64')}`
  } catch {
    return null
  }
}

export function disposeHomeChat(): void {
  child?.kill('SIGTERM')
  child = null
}

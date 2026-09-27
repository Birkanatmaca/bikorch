import type { DailyLearnLesson } from '@shared/contracts/secretary'
import { MEMORY_CATEGORIES, type DeveloperMemory } from '@shared/contracts/developer-intelligence'
import type { SecretaryResponseFormat } from './response-schema'
import { sanitizeSecretaryModelText } from './input-sanitizer'

const WORK_CATEGORIES = MEMORY_CATEGORIES.filter((category) => category !== 'About me')
const LESSON_ORDER = ['Languages', 'Architecture', 'Tooling', 'Coding style', 'Workflow', 'Communication', 'Other'] as const

export const DAILY_LEARN_FORMAT: SecretaryResponseFormat = {
  name: 'developer_daily_learn',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['topic', 'body', 'basis'],
    properties: {
      topic: { type: 'string' },
      body: { type: 'string' },
      basis: { type: 'string' }
    }
  }
}

export const DAILY_LEARN_SYSTEM = `Teach this developer one practical lesson for today. Use only the supplied work memories. Do not invent identity, biography, employers, or tools that those memories do not mention.
Pick one concrete technique they would use in that work, and choose a different technique from recentTopics. A developer who writes Go might get concurrency one day. A developer who writes React or mobile UI might get state management another day.
topic is a short title. body is two or three sentences: what the technique is, why it matters in their work, and what it enables. basis is the memory category you used.
Write in English. No credentials, file paths, or instructions about Bikorch.`

export interface DailyLearnRecord {
  lessons: DailyLearnLesson[]
  failedOn: string | null
}

export function localDateKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function memoriesForDailyLearn(memories: DeveloperMemory[]): Array<{ category: string; content: string }> {
  const rank = (category: string): number => {
    const index = LESSON_ORDER.indexOf(category as typeof LESSON_ORDER[number])
    return index === -1 ? LESSON_ORDER.length : index
  }
  return memories
    .filter((memory) => memory.enabled && memory.category !== 'About me')
    .sort((left, right) => rank(left.category) - rank(right.category) || right.lastSeenAt - left.lastSeenAt)
    .slice(0, 12)
    .flatMap((memory) => {
      const content = sanitizeSecretaryModelText(memory.content, 240)
      if (content.length < 8) return []
      const category = WORK_CATEGORIES.includes(memory.category as typeof WORK_CATEGORIES[number])
        ? memory.category
        : 'Other'
      return [{ category, content }]
    })
}

export function parseDailyLearnRecord(raw: string | null): DailyLearnRecord {
  if (!raw) return { lessons: [], failedOn: null }
  try {
    const parsed = JSON.parse(raw) as { lessons?: unknown; failedOn?: unknown }
    const lessons = Array.isArray(parsed.lessons)
      ? parsed.lessons.flatMap((item) => {
          const lesson = parseDailyLearnLesson(item, typeof (item as { date?: unknown })?.date === 'string' ? (item as { date: string }).date : '')
          return lesson ? [lesson] : []
        })
      : []
    return {
      lessons: lessons.slice(0, 14),
      failedOn: typeof parsed.failedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.failedOn) ? parsed.failedOn : null
    }
  } catch {
    return { lessons: [], failedOn: null }
  }
}

export function lessonForDate(record: DailyLearnRecord, date: string): DailyLearnLesson | null {
  return record.lessons.find((lesson) => lesson.date === date) ?? null
}

export function recentTopics(record: DailyLearnRecord, date: string): string[] {
  return record.lessons.filter((lesson) => lesson.date !== date).slice(0, 8).map((lesson) => lesson.topic)
}

export function withLesson(record: DailyLearnRecord, lesson: DailyLearnLesson): DailyLearnRecord {
  return {
    lessons: [lesson, ...record.lessons.filter((item) => item.date !== lesson.date)].slice(0, 14),
    failedOn: null
  }
}

export function withFailure(record: DailyLearnRecord, date: string): DailyLearnRecord {
  return { lessons: record.lessons, failedOn: date }
}

export function parseDailyLearnLesson(raw: unknown, date: string): DailyLearnLesson | null {
  if (!raw || typeof raw !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const value = raw as { topic?: unknown; body?: unknown; basis?: unknown }
  const topic = typeof value.topic === 'string' ? sanitizeSecretaryModelText(value.topic, 80) : ''
  const body = typeof value.body === 'string' ? sanitizeSecretaryModelText(value.body, 480) : ''
  if (topic.length < 3 || body.length < 40) return null
  const basisText = typeof value.basis === 'string' ? sanitizeSecretaryModelText(value.basis, 40) : ''
  const basis = WORK_CATEGORIES.includes(basisText as typeof WORK_CATEGORIES[number]) ? basisText : 'Work'
  return { date, topic, body, basis }
}

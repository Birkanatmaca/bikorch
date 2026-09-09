import { describe, expect, it } from 'vitest'
import {
  nextTaskStatus,
  parseTaskStatus,
  summarizeTasks,
  type ProjectTask
} from '../tasks'

function task(overrides: Partial<ProjectTask> & Pick<ProjectTask, 'id' | 'status'>): ProjectTask {
  return {
    title: overrides.title ?? overrides.id,
    priority: 'medium',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('task board stats', () => {
  it('parses wait as a real status', () => {
    expect(parseTaskStatus('wait')).toBe('wait')
    expect(parseTaskStatus('blocked')).toBe('todo')
  })

  it('cycles to do → doing → wait → done', () => {
    expect(nextTaskStatus('todo')).toBe('in-progress')
    expect(nextTaskStatus('in-progress')).toBe('wait')
    expect(nextTaskStatus('wait')).toBe('done')
    expect(nextTaskStatus('done')).toBe('todo')
  })

  it('counts open, wait, and done-this-week', () => {
    const now = 1_000_000_000_000
    const stats = summarizeTasks(
      [
        task({ id: 'a', status: 'todo' }),
        task({ id: 'b', status: 'in-progress' }),
        task({ id: 'c', status: 'wait' }),
        task({ id: 'd', status: 'done', completedAt: now - 2 * 24 * 60 * 60 * 1000 }),
        task({ id: 'e', status: 'done', completedAt: now - 10 * 24 * 60 * 60 * 1000 })
      ],
      now
    )
    expect(stats).toMatchObject({
      total: 5,
      todo: 1,
      inProgress: 1,
      wait: 1,
      done: 2,
      open: 3,
      doneThisWeek: 1
    })
  })
})

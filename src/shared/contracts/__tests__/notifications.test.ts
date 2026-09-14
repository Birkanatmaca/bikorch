import { describe, expect, it } from 'vitest'
import { cliTaskNotificationCopy } from '../notifications'

describe('cliTaskNotificationCopy', () => {
  it('names the finished CLI and project for Notification Center', () => {
    expect(
      cliTaskNotificationCopy({
        title: 'Cursor CLI',
        projectName: 'shop',
        outcome: 'done'
      })
    ).toEqual({
      title: 'Task finished',
      body: 'Cursor CLI finished in shop'
    })
  })

  it('uses a failure title when the run ended in error', () => {
    expect(
      cliTaskNotificationCopy({
        title: 'Claude Code',
        projectName: 'shop',
        outcome: 'error'
      })
    ).toEqual({
      title: 'Task failed',
      body: 'Claude Code failed in shop'
    })
  })
})

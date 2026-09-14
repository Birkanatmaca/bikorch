export type CliTaskNotificationOutcome = 'done' | 'error'

export interface CliTaskNotification {
  projectId: string
  panelId: string
  projectName: string
  title: string
  outcome: CliTaskNotificationOutcome
}

export function cliTaskNotificationCopy(input: Pick<CliTaskNotification, 'title' | 'projectName' | 'outcome'>): {
  title: string
  body: string
} {
  const finished = input.outcome !== 'error'
  return {
    title: finished ? 'Task finished' : 'Task failed',
    body: `${input.title} ${finished ? 'finished' : 'failed'} in ${input.projectName}`
  }
}

export const NOTIFICATION_IPC = {
  SHOW_CLI_TASK: 'notifications:show-cli-task',
  CLICKED: 'notifications:clicked'
} as const

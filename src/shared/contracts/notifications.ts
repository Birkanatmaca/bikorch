export type CliTaskNotificationOutcome = 'done' | 'error'

export interface CliTaskNotification {
  projectId: string
  panelId: string
  projectName: string
  title: string
  outcome: CliTaskNotificationOutcome
  /** Optional richer copy, e.g. the Manager's "what I did" summary. */
  heading?: string
  summary?: string
}

export function cliTaskNotificationCopy(input: Pick<CliTaskNotification, 'title' | 'projectName' | 'outcome' | 'heading' | 'summary'>): {
  title: string
  body: string
} {
  const finished = input.outcome !== 'error'
  if (input.heading || input.summary) {
    return {
      title: input.heading || (finished ? 'Task finished' : 'Task failed'),
      body: input.summary || `${input.title} in ${input.projectName}`
    }
  }
  return {
    title: finished ? 'Task finished' : 'Task failed',
    body: `${input.title} ${finished ? 'finished' : 'failed'} in ${input.projectName}`
  }
}

export const NOTIFICATION_IPC = {
  SHOW_CLI_TASK: 'notifications:show-cli-task',
  CLICKED: 'notifications:clicked'
} as const

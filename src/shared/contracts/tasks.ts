export type TaskStatus = 'todo' | 'in-progress' | 'wait' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'wait', 'done']
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'Doing',
  wait: 'Wait',
  done: 'Done'
}

export const TASK_PRIORITIES: TaskPriority[] = ['high', 'medium', 'low']
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

export interface ProjectTask {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface TasksSnapshot {
  tasksByProject: Record<string, ProjectTask[]>
}

export interface TaskBoardStats {
  total: number
  todo: number
  inProgress: number
  wait: number
  done: number
  open: number
  doneThisWeek: number
}

export function parseTaskStatus(value: unknown): TaskStatus {
  return value === 'in-progress' || value === 'wait' || value === 'done' ? value : 'todo'
}

export function isOpenTaskStatus(status: TaskStatus): boolean {
  return status !== 'done'
}

export function nextTaskStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') return 'in-progress'
  if (status === 'in-progress') return 'wait'
  if (status === 'wait') return 'done'
  return 'todo'
}

export function summarizeTasks(tasks: ProjectTask[], now = Date.now()): TaskBoardStats {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const stats: TaskBoardStats = {
    total: tasks.length,
    todo: 0,
    inProgress: 0,
    wait: 0,
    done: 0,
    open: 0,
    doneThisWeek: 0
  }

  for (const task of tasks) {
    if (task.status === 'todo') stats.todo += 1
    else if (task.status === 'in-progress') stats.inProgress += 1
    else if (task.status === 'wait') stats.wait += 1
    else stats.done += 1

    if (isOpenTaskStatus(task.status)) stats.open += 1
    if (task.status === 'done') {
      const completedAt = task.completedAt ?? task.updatedAt
      if (completedAt >= weekAgo) stats.doneThisWeek += 1
    }
  }

  return stats
}

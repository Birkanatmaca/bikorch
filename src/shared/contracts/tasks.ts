export type TaskStatus = 'todo' | 'in-progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

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
}

export interface TasksSnapshot {
  tasksByProject: Record<string, ProjectTask[]>
}

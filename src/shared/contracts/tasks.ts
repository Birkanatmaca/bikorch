export type TaskStatus = 'todo' | 'in-progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

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

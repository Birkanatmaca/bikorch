import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ProjectTask, TaskPriority, TaskStatus, TasksSnapshot } from '@shared/contracts/tasks'
import { recordDeveloperEvent } from '@renderer/lib/developer-events'

function withStatusFields(task: ProjectTask, status: TaskStatus, now: number): ProjectTask {
  if (status === 'done') {
    return {
      ...task,
      status,
      updatedAt: now,
      completedAt: task.status === 'done' ? (task.completedAt ?? now) : now
    }
  }
  const next = { ...task, status, updatedAt: now }
  delete next.completedAt
  return next
}

function noteTaskTransition(projectId: string, task: ProjectTask, previousStatus: TaskStatus): void {
  if (task.status === previousStatus) return
  const type =
    task.status === 'done'
      ? 'task.completed'
      : task.status === 'in-progress'
        ? 'task.started'
        : null
  if (!type) return
  recordDeveloperEvent({
    type,
    projectId,
    payload: { taskId: task.id, title: task.title, priority: task.priority }
  })
}

interface TasksStore extends TasksSnapshot {
  hydrate: (snapshot: Partial<TasksSnapshot>) => void
  getSnapshot: () => TasksSnapshot
  addTask: (projectId: string, title: string, priority?: TaskPriority) => string | null
  updateTask: (projectId: string, taskId: string, updates: Partial<Pick<ProjectTask, 'title' | 'status' | 'priority'>>) => void
  setTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void
  removeTask: (projectId: string, taskId: string) => void
  clearCompleted: (projectId: string) => void
}

function normalizedTitle(title: string): string {
  return title.trim().slice(0, 500)
}

export const useTasksStore = create<TasksStore>((set, get) => ({
  tasksByProject: {},

  hydrate: (snapshot) => {
    set({
      tasksByProject: snapshot.tasksByProject ?? {}
    })
  },

  getSnapshot: () => ({
    tasksByProject: get().tasksByProject
  }),

  addTask: (projectId, title, priority = 'medium') => {
    const normalized = normalizedTitle(title)
    if (!normalized) return null

    const now = Date.now()
    const task: ProjectTask = {
      id: uuidv4(),
      title: normalized,
      status: 'todo',
      priority,
      createdAt: now,
      updatedAt: now
    }

    set((state) => ({
      tasksByProject: {
        ...state.tasksByProject,
        [projectId]: [...(state.tasksByProject[projectId] ?? []), task]
      }
    }))
    return task.id
  },

  updateTask: (projectId, taskId, updates) => {
    let transition: { task: ProjectTask; previousStatus: TaskStatus } | null = null
    set((state) => ({
      tasksByProject: {
        ...state.tasksByProject,
        [projectId]: (state.tasksByProject[projectId] ?? []).map((task) => {
          if (task.id !== taskId) return task
          const title = updates.title === undefined ? task.title : normalizedTitle(updates.title)
          if (updates.title !== undefined && !title) return task
          const now = Date.now()
          let next: ProjectTask = {
            ...task,
            ...updates,
            ...(updates.title !== undefined ? { title } : {}),
            updatedAt: now
          }
          if (updates.status !== undefined) {
            next = withStatusFields(
              { ...next, status: task.status, completedAt: task.completedAt },
              updates.status,
              now
            )
            if (updates.title !== undefined) next.title = title
          }
          transition = { task: next, previousStatus: task.status }
          return next
        })
      }
    }))
    if (transition) {
      const { task, previousStatus } = transition as { task: ProjectTask; previousStatus: TaskStatus }
      noteTaskTransition(projectId, task, previousStatus)
    }
  },

  setTaskStatus: (projectId, taskId, status) => {
    get().updateTask(projectId, taskId, { status })
  },

  removeTask: (projectId, taskId) => {
    set((state) => ({
      tasksByProject: {
        ...state.tasksByProject,
        [projectId]: (state.tasksByProject[projectId] ?? []).filter((task) => task.id !== taskId)
      }
    }))
  },

  clearCompleted: (projectId) => {
    set((state) => ({
      tasksByProject: {
        ...state.tasksByProject,
        [projectId]: (state.tasksByProject[projectId] ?? []).filter((task) => task.status !== 'done')
      }
    }))
  }
}))

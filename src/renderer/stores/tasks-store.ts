import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ProjectTask, TaskPriority, TaskStatus, TasksSnapshot } from '@shared/contracts/tasks'

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
    set((state) => ({
      tasksByProject: {
        ...state.tasksByProject,
        [projectId]: (state.tasksByProject[projectId] ?? []).map((task) => {
          if (task.id !== taskId) return task
          const title = updates.title === undefined ? task.title : normalizedTitle(updates.title)
          if (updates.title !== undefined && !title) return task
          return {
            ...task,
            ...updates,
            ...(updates.title !== undefined ? { title } : {}),
            updatedAt: Date.now()
          }
        })
      }
    }))
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

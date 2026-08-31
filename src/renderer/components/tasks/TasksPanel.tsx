import { useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  ListChecks,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { ProjectTask, TaskPriority, TaskStatus } from '@shared/contracts/tasks'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { useTasksStore } from '@renderer/stores/tasks-store'

type TaskFilter = 'all' | 'active' | 'done'

const priorityClasses: Record<TaskPriority, string> = {
  low: 'border-border text-text-muted',
  medium: 'border-info/30 bg-info/10 text-info',
  high: 'border-warning/30 bg-warning/10 text-warning'
}

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done'
}

const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
const statusOrder: Record<TaskStatus, number> = { 'in-progress': 0, todo: 1, done: 2 }

function sortTasks(a: ProjectTask, b: ProjectTask): number {
  if (statusOrder[a.status] !== statusOrder[b.status]) {
    return statusOrder[a.status] - statusOrder[b.status]
  }
  if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  }
  return b.updatedAt - a.updatedAt
}

function nextStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') return 'in-progress'
  if (status === 'in-progress') return 'done'
  return 'todo'
}

export function TasksPanel(): React.JSX.Element {
  const { projectId, projectName } = useActiveProject()
  const tasks = useTasksStore((state) => (projectId ? state.tasksByProject[projectId] ?? [] : []))
  const addTask = useTasksStore((state) => state.addTask)
  const updateTask = useTasksStore((state) => state.updateTask)
  const setTaskStatus = useTasksStore((state) => state.setTaskStatus)
  const removeTask = useTasksStore((state) => state.removeTask)
  const clearCompleted = useTasksStore((state) => state.clearCompleted)

  const [draft, setDraft] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [query, setQuery] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const doneCount = tasks.filter((task) => task.status === 'done').length
  const activeCount = tasks.length - doneCount
  const progress = tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100)

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...tasks]
      .filter((task) => {
        if (filter === 'active' && task.status === 'done') return false
        if (filter === 'done' && task.status !== 'done') return false
        return !needle || task.title.toLowerCase().includes(needle)
      })
      .sort(sortTasks)
  }, [filter, query, tasks])

  const handleAdd = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!projectId || !draft.trim()) return
    addTask(projectId, draft, priority)
    setDraft('')
  }

  const beginEdit = (task: ProjectTask): void => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }

  const finishEdit = (): void => {
    if (!projectId || !editingTaskId) return
    const title = editingTitle.trim()
    if (title) updateTask(projectId, editingTaskId, { title })
    setEditingTaskId(null)
    setEditingTitle('')
  }

  if (!projectId) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No active project"
        description="Open a project to start planning work in this task list."
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="shrink-0 border-b border-border bg-elevated px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-text-primary">{projectName ?? 'Project tasks'}</p>
            <p className="mt-0.5 font-mono text-[10px] text-text-muted">
              {doneCount} of {tasks.length} complete
            </p>
          </div>
          <span className="font-mono text-xs text-primary">{progress}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <form onSubmit={handleAdd} className="flex shrink-0 gap-1.5 border-b border-border p-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a task..."
          maxLength={500}
          className="min-w-0 flex-1 rounded-md border border-border bg-panel-bg px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-primary/50"
          aria-label="New task title"
        />
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as TaskPriority)}
          className="w-[82px] rounded-md border border-border bg-panel-bg px-1.5 py-1.5 text-[10px] text-text-secondary outline-none focus:border-primary/50"
          aria-label="New task priority"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-md border border-primary/40 bg-primary/10 px-2 text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
          title="Add task"
          aria-label="Add task"
        >
          <Plus className="h-4 w-4" />
        </button>
      </form>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {(['all', 'active', 'done'] as TaskFilter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={cn(
              'rounded px-2 py-1 text-[10px] transition-colors',
              filter === option
                ? 'bg-primary/10 text-primary'
                : 'text-text-muted hover:bg-hover hover:text-text-primary'
            )}
          >
            {option === 'all' ? `All (${tasks.length})` : option === 'active' ? `Active (${activeCount})` : `Done (${doneCount})`}
          </button>
        ))}
        {doneCount > 0 && (
          <button
            type="button"
            onClick={() => clearCompleted(projectId)}
            className="ml-auto rounded px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-error/10 hover:text-error"
          >
            Clear done
          </button>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="shrink-0 border-b border-border px-2 py-1.5">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks..."
            className="w-full rounded-md border border-border bg-panel-bg px-2.5 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-primary/50"
            aria-label="Search tasks"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visibleTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}
            description={
              tasks.length === 0
                ? 'Add the next piece of work above to keep your project moving.'
                : 'Try a different filter or search term.'
            }
            className="min-h-[220px]"
          />
        ) : (
          <div className="space-y-1">
            {visibleTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'group rounded-md border border-border bg-panel-bg p-2 transition-colors hover:border-primary/30',
                  task.status === 'done' && 'opacity-70'
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setTaskStatus(projectId, task.id, nextStatus(task.status))}
                    className={cn('mt-0.5 shrink-0 transition-colors', task.status === 'done' ? 'text-success' : 'text-text-muted hover:text-primary')}
                    title={`Mark as ${statusLabels[nextStatus(task.status)]}`}
                    aria-label={`Mark task as ${statusLabels[nextStatus(task.status)]}`}
                  >
                    {task.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : task.status === 'in-progress' ? (
                      <CircleDot className="h-4 w-4 text-primary" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {editingTaskId === task.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={finishEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') finishEdit()
                          if (event.key === 'Escape') {
                            setEditingTaskId(null)
                            setEditingTitle('')
                          }
                        }}
                        maxLength={500}
                        className="w-full rounded border border-primary/40 bg-app-bg px-1.5 py-1 text-xs text-text-primary outline-none"
                        aria-label="Edit task title"
                      />
                    ) : (
                      <p
                        className={cn(
                          'break-words text-xs text-text-primary',
                          task.status === 'done' && 'text-text-muted line-through'
                        )}
                        title="Double-click or use the edit button to rename"
                      >
                        {task.title}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className={cn('rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide', priorityClasses[task.priority])}>
                        {task.priority}
                      </span>
                      <select
                        value={task.status}
                        onChange={(event) => setTaskStatus(projectId, task.id, event.target.value as TaskStatus)}
                        className="rounded border border-border bg-app-bg px-1 py-0.5 text-[9px] text-text-muted outline-none focus:border-primary/50"
                        aria-label={`${task.title} status`}
                      >
                        <option value="todo">To do</option>
                        <option value="in-progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                      <select
                        value={task.priority}
                        onChange={(event) => updateTask(projectId, task.id, { priority: event.target.value as TaskPriority })}
                        className="rounded border border-border bg-app-bg px-1 py-0.5 text-[9px] text-text-muted outline-none focus:border-primary/50"
                        aria-label={`${task.title} priority`}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => beginEdit(task)}
                      className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"
                      title="Edit task"
                      aria-label="Edit task"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(projectId, task.id)}
                      className="rounded p-1 text-text-muted hover:bg-error/10 hover:text-error"
                      title="Delete task"
                      aria-label="Delete task"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {task.status === 'done' && (
                  <div className="mt-1 flex items-center gap-1 pl-6 font-mono text-[9px] text-success">
                    <Check className="h-3 w-3" /> Completed
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

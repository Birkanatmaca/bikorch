import { useMemo, useState } from 'react'
import {
  Circle,
  CircleDot,
  Check,
  Plus,
  Search,
  Trash2,
  ListChecks
} from 'lucide-react'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type ProjectTask,
  type TaskPriority,
  type TaskStatus
} from '@shared/contracts/tasks'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { useTasksStore } from '@renderer/stores/tasks-store'

type TaskFilter = 'all' | 'active' | 'done'
type PriorityFilter = 'all' | TaskPriority

const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
const statusOrder: Record<TaskStatus, number> = { 'in-progress': 0, todo: 1, done: 2 }
const EMPTY_TASKS: ProjectTask[] = []

function sortTasks(a: ProjectTask, b: ProjectTask): number {
  const aDone = a.status === 'done' ? 1 : 0
  const bDone = b.status === 'done' ? 1 : 0
  if (aDone !== bDone) return aDone - bDone
  if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  }
  if (statusOrder[a.status] !== statusOrder[b.status]) {
    return statusOrder[a.status] - statusOrder[b.status]
  }
  return b.updatedAt - a.updatedAt
}

function nextStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') return 'in-progress'
  if (status === 'in-progress') return 'done'
  return 'todo'
}

function nextPriority(priority: TaskPriority): TaskPriority {
  if (priority === 'medium') return 'high'
  if (priority === 'high') return 'low'
  return 'medium'
}

function statusLabel(status: TaskStatus): string {
  if (status === 'in-progress') return 'In progress'
  if (status === 'done') return 'Done'
  return 'To do'
}

function PriorityDot({
  priority,
  selected,
  onClick,
  title
}: {
  priority: TaskPriority
  selected?: boolean
  onClick: () => void
  title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn('task-priority', `is-${priority}`, selected && 'is-selected')}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={selected}
    />
  )
}

export function TasksPanel(): React.JSX.Element {
  const { projectId, projectName } = useActiveProject()
  const tasks = useTasksStore((state) => state.tasksByProject[projectId ?? ''] ?? EMPTY_TASKS)
  const addTask = useTasksStore((state) => state.addTask)
  const updateTask = useTasksStore((state) => state.updateTask)
  const setTaskStatus = useTasksStore((state) => state.setTaskStatus)
  const removeTask = useTasksStore((state) => state.removeTask)
  const clearCompleted = useTasksStore((state) => state.clearCompleted)

  const [draft, setDraft] = useState('')
  const [draftPriority, setDraftPriority] = useState<TaskPriority>('medium')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [query, setQuery] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const doneCount = tasks.filter((task) => task.status === 'done').length
  const activeCount = tasks.length - doneCount
  const openByPriority = useMemo(() => {
    const counts: Record<TaskPriority, number> = { high: 0, medium: 0, low: 0 }
    for (const task of tasks) {
      if (task.status !== 'done') counts[task.priority] += 1
    }
    return counts
  }, [tasks])

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...tasks]
      .filter((task) => {
        if (filter === 'active' && task.status === 'done') return false
        if (filter === 'done' && task.status !== 'done') return false
        if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
        return !needle || task.title.toLowerCase().includes(needle)
      })
      .sort(sortTasks)
  }, [filter, priorityFilter, query, tasks])

  const groups = useMemo(() => {
    const open = visibleTasks.filter((task) => task.status !== 'done')
    const done = visibleTasks.filter((task) => task.status === 'done')
    const priorityGroups = TASK_PRIORITIES.map((priority) => ({
      key: priority,
      label: TASK_PRIORITY_LABELS[priority],
      tasks: open.filter((task) => task.priority === priority)
    })).filter((group) => group.tasks.length > 0)
    if (done.length === 0) return priorityGroups
    return [...priorityGroups, { key: 'done' as const, label: 'Done', tasks: done }]
  }, [visibleTasks])

  const showGroupLabels = groups.length > 1

  const handleAdd = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!projectId || !draft.trim()) return
    addTask(projectId, draft, draftPriority)
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

  const togglePriorityFilter = (priority: TaskPriority): void => {
    setPriorityFilter((current) => (current === priority ? 'all' : priority))
  }

  if (!projectId) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No active project"
        description="Open a project to keep a quiet list of what comes next."
      />
    )
  }

  return (
    <div className="task-workbench flex h-full min-h-0 flex-col">
      <div className="task-header shrink-0">
        <p className="task-header-title">{projectName ?? 'Tasks'}</p>
        {tasks.length > 0 ? (
          <span className="task-header-count">
            {activeCount === 0 ? 'All done' : `${activeCount} left`}
          </span>
        ) : null}
      </div>

      <form onSubmit={handleAdd} className="task-composer shrink-0">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a task"
          maxLength={500}
          className="task-composer-input"
          aria-label="New task"
        />
        <div className="task-composer-priority" role="group" aria-label="Priority">
          {TASK_PRIORITIES.map((priority) => (
            <PriorityDot
              key={priority}
              priority={priority}
              selected={draftPriority === priority}
              onClick={() => setDraftPriority(priority)}
              title={`${TASK_PRIORITY_LABELS[priority]} priority`}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="task-submit"
          title="Add task"
          aria-label="Add task"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </form>

      {tasks.length > 0 ? (
        <div className="task-stats shrink-0" aria-label="Open tasks by priority">
          {TASK_PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              className={cn(
                'task-stat',
                `is-${priority}`,
                priorityFilter === priority && 'is-active',
                openByPriority[priority] === 0 && 'is-empty'
              )}
              onClick={() => togglePriorityFilter(priority)}
              title={`${TASK_PRIORITY_LABELS[priority]} · ${openByPriority[priority]} open`}
            >
              <span className={cn('task-priority', `is-${priority}`)} aria-hidden />
              <strong>{openByPriority[priority]}</strong>
              <span>{TASK_PRIORITY_LABELS[priority]}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="task-toolbar shrink-0">
        <div className="task-filters">
          {(['all', 'active', 'done'] as TaskFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn('task-filter', filter === option && 'is-active')}
            >
              {option === 'all' ? 'All' : option === 'active' ? 'Open' : 'Done'}
            </button>
          ))}
        </div>
        {doneCount > 0 ? (
          <button
            type="button"
            onClick={() => clearCompleted(projectId)}
            className="task-clear"
          >
            Clear
          </button>
        ) : null}
      </div>

      {tasks.length > 4 ? (
        <div className="task-search shrink-0">
          <Search className="h-3.5 w-3.5" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            className="task-search-input"
            aria-label="Filter tasks"
          />
        </div>
      ) : null}

      <div className="task-list min-h-0 flex-1 overflow-auto">
        {visibleTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={tasks.length === 0 ? 'Nothing here yet' : 'No matching tasks'}
            description={
              tasks.length === 0
                ? 'Pick a priority, type above, press Enter.'
                : 'Try a different filter.'
            }
            className="min-h-[140px]"
          />
        ) : (
          <ul className="task-rows">
            {groups.map((group) => (
              <li key={group.key} className="task-group">
                {showGroupLabels ? (
                  <p className="task-group-label">{group.label}</p>
                ) : null}
                <ul>
                  {group.tasks.map((task) => (
                    <li
                      key={task.id}
                      className={cn('task-item', task.status === 'done' && 'is-done')}
                    >
                      <button
                        type="button"
                        onClick={() => setTaskStatus(projectId, task.id, nextStatus(task.status))}
                        className={cn('task-check', `is-${task.status}`)}
                        title={`Mark as ${statusLabel(nextStatus(task.status))}`}
                        aria-label={`Mark ${task.title} as ${statusLabel(nextStatus(task.status))}`}
                      >
                        {task.status === 'done' ? (
                          <Check className="h-3 w-3" strokeWidth={2.6} />
                        ) : task.status === 'in-progress' ? (
                          <CircleDot className="h-3.5 w-3.5" />
                        ) : (
                          <Circle className="h-3.5 w-3.5" />
                        )}
                      </button>

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
                          className="task-edit-input"
                          aria-label="Edit task title"
                        />
                      ) : (
                        <button
                          type="button"
                          className="task-title"
                          onDoubleClick={() => beginEdit(task)}
                          title={`${task.title} · ${TASK_PRIORITY_LABELS[task.priority]} · Double-click to rename`}
                        >
                          {task.title}
                        </button>
                      )}

                      <PriorityDot
                        priority={task.priority}
                        onClick={() =>
                          updateTask(projectId, task.id, { priority: nextPriority(task.priority) })
                        }
                        title={`${TASK_PRIORITY_LABELS[task.priority]} priority. Click to change.`}
                      />

                      <button
                        type="button"
                        onClick={() => removeTask(projectId, task.id)}
                        className="task-delete"
                        title="Delete task"
                        aria-label={`Delete ${task.title}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

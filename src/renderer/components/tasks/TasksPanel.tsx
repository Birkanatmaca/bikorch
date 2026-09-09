import { useMemo, useState } from 'react'
import { Circle, CircleDot, Check, Clock, Plus, Search, Trash2, ListChecks } from 'lucide-react'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isOpenTaskStatus,
  nextTaskStatus,
  summarizeTasks,
  type ProjectTask,
  type TaskPriority,
  type TaskStatus
} from '@shared/contracts/tasks'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { useTasksStore } from '@renderer/stores/tasks-store'

type TaskFilter = 'all' | TaskStatus
type PriorityFilter = 'all' | TaskPriority

const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
const statusOrder: Record<TaskStatus, number> = {
  'in-progress': 0,
  wait: 1,
  todo: 2,
  done: 3
}
const GROUP_ORDER: TaskStatus[] = ['in-progress', 'wait', 'todo', 'done']
const EMPTY_TASKS: ProjectTask[] = []

function sortTasks(a: ProjectTask, b: ProjectTask): number {
  if (statusOrder[a.status] !== statusOrder[b.status]) {
    return statusOrder[a.status] - statusOrder[b.status]
  }
  if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  }
  return b.updatedAt - a.updatedAt
}

function nextPriority(priority: TaskPriority): TaskPriority {
  if (priority === 'medium') return 'high'
  if (priority === 'high') return 'low'
  return 'medium'
}

function StatusIcon({ status }: { status: TaskStatus }): React.JSX.Element {
  if (status === 'done') return <Check className="h-3 w-3" strokeWidth={2.6} />
  if (status === 'in-progress') return <CircleDot className="h-3.5 w-3.5" />
  if (status === 'wait') return <Clock className="h-3.5 w-3.5" />
  return <Circle className="h-3.5 w-3.5" />
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

function countForStatus(stats: ReturnType<typeof summarizeTasks>, status: TaskStatus): number {
  if (status === 'todo') return stats.todo
  if (status === 'in-progress') return stats.inProgress
  if (status === 'wait') return stats.wait
  return stats.done
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

  const stats = useMemo(() => summarizeTasks(tasks), [tasks])

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...tasks]
      .filter((task) => {
        if (filter !== 'all' && task.status !== filter) return false
        if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
        return !needle || task.title.toLowerCase().includes(needle)
      })
      .sort(sortTasks)
  }, [filter, priorityFilter, query, tasks])

  const groups = useMemo(() => {
    return GROUP_ORDER.map((status) => ({
      key: status,
      label: TASK_STATUS_LABELS[status],
      tasks: visibleTasks.filter((task) => task.status === status)
    })).filter((group) => group.tasks.length > 0)
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

  const toggleStatusFilter = (status: TaskStatus): void => {
    setFilter((current) => (current === status ? 'all' : status))
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
            {stats.open === 0 ? 'All done' : `${stats.open} open`}
            {stats.wait > 0 ? ` · ${stats.wait} wait` : ''}
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
        <div className="task-stats shrink-0" aria-label="Task status counts">
          {TASK_STATUSES.map((status) => {
            const count = countForStatus(stats, status)
            return (
              <button
                key={status}
                type="button"
                className={cn(
                  'task-stat',
                  `is-status-${status}`,
                  filter === status && 'is-active',
                  count === 0 && 'is-empty'
                )}
                onClick={() => toggleStatusFilter(status)}
                title={`${TASK_STATUS_LABELS[status]} · ${count}`}
              >
                <span className={cn('task-status-dot', `is-${status}`)} aria-hidden />
                <strong>{count}</strong>
                <span>{TASK_STATUS_LABELS[status]}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {stats.doneThisWeek > 0 ? (
        <p className="task-week shrink-0">{stats.doneThisWeek} done this week</p>
      ) : null}

      {tasks.some((task) => isOpenTaskStatus(task.status)) ? (
        <div className="task-stats is-priority shrink-0" aria-label="Open tasks by priority">
          {TASK_PRIORITIES.map((priority) => {
            const count = tasks.filter(
              (task) => isOpenTaskStatus(task.status) && task.priority === priority
            ).length
            return (
              <button
                key={priority}
                type="button"
                className={cn(
                  'task-stat',
                  `is-${priority}`,
                  priorityFilter === priority && 'is-active',
                  count === 0 && 'is-empty'
                )}
                onClick={() => togglePriorityFilter(priority)}
                title={`${TASK_PRIORITY_LABELS[priority]} · ${count} open`}
              >
                <span className={cn('task-priority', `is-${priority}`)} aria-hidden />
                <strong>{count}</strong>
                <span>{TASK_PRIORITY_LABELS[priority]}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="task-toolbar shrink-0">
        <div className="task-filters">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn('task-filter', filter === 'all' && 'is-active')}
          >
            All
          </button>
        </div>
        {stats.done > 0 ? (
          <button type="button" onClick={() => clearCompleted(projectId)} className="task-clear">
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
                {showGroupLabels ? <p className="task-group-label">{group.label}</p> : null}
                <ul>
                  {group.tasks.map((task) => (
                    <li
                      key={task.id}
                      className={cn(
                        'task-item',
                        task.status === 'done' && 'is-done',
                        task.status === 'wait' && 'is-wait'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setTaskStatus(projectId, task.id, nextTaskStatus(task.status))}
                        className={cn('task-check', `is-${task.status}`)}
                        title={`Mark as ${TASK_STATUS_LABELS[nextTaskStatus(task.status)]}`}
                        aria-label={`Mark ${task.title} as ${TASK_STATUS_LABELS[nextTaskStatus(task.status)]}`}
                      >
                        <StatusIcon status={task.status} />
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
                          title={`${task.title} · ${TASK_STATUS_LABELS[task.status]} · ${TASK_PRIORITY_LABELS[task.priority]} · Double-click to rename`}
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

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Ban,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileJson,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Square,
  Trash2,
  X,
  XCircle
} from 'lucide-react'
import type {
  LogEntry,
  Task,
  TaskDetail,
  TaskStatus
} from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Spinner,
  Tabs
} from '../components/ui'
import { errorMessage } from '../lib/errors'
import { duration, fullTime, plural, relativeTime, taskStatusLabel } from '../lib/format'
import clsx from 'clsx'

type ActivityTab = 'tasks' | 'logs'
type TaskFilter = 'all' | 'active' | TaskStatus

const ACTIVE = new Set<TaskStatus>(['queued', 'planning', 'awaiting_confirmation', 'running'])

function statusTone(status: TaskStatus): 'accent' | 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'running' || status === 'planning') return 'accent'
  if (status === 'queued') return 'neutral'
  if (status === 'awaiting_confirmation') return 'warning'
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'queued') return <Clock3 size={13} />
  if (status === 'planning' || status === 'running') return <Loader2 size={13} className="spin" />
  if (status === 'awaiting_confirmation') return <ShieldAlert size={13} />
  if (status === 'completed') return <Check size={13} />
  if (status === 'failed') return <XCircle size={13} />
  return <Ban size={13} />
}

export function ActivityPage() {
  const navigate = useNavigate()
  const tasks = useAppStore((state) => state.tasks)
  const refreshTasks = useAppStore((state) => state.refreshTasks)
  const notify = useAppStore((state) => state.notify)

  const [tab, setTab] = useState<ActivityTab>('tasks')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [clearLogsOpen, setClearLogsOpen] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let active = true
    setDetailLoading(true)
    void window.igris.tasks
      .get(selectedId)
      .then((result) => {
        if (active) setDetail(result)
      })
      .catch((error: unknown) => {
        if (active) notify('error', 'Could not load task detail', errorMessage(error))
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedId, tasks, notify])

  useEffect(() => {
    if (tab !== 'logs') return
    let active = true
    setLogsLoading(true)
    void window.igris.diagnostics
      .logs(250)
      .then((result) => {
        if (active) setLogs(result)
      })
      .catch((error: unknown) => {
        if (active) notify('error', 'Could not read logs', errorMessage(error))
      })
      .finally(() => {
        if (active) setLogsLoading(false)
      })
    return () => {
      active = false
    }
  }, [tab, notify])

  const filtered = useMemo(() => {
    if (filter === 'all') return tasks
    if (filter === 'active') return tasks.filter((task) => ACTIVE.has(task.status))
    return tasks.filter((task) => task.status === filter)
  }, [tasks, filter])

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      active: tasks.filter((task) => ACTIVE.has(task.status)).length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      failed: tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').length
    }
  }, [tasks])

  const cancelTask = async (task: Task): Promise<void> => {
    setBusyId(task.id)
    try {
      await window.igris.tasks.cancel(task.id)
      notify('success', 'Task cancelled')
      await refreshTasks()
    } catch (error) {
      notify('error', 'Could not cancel task', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const retryTask = async (task: Task): Promise<void> => {
    setBusyId(task.id)
    try {
      const handle = await window.igris.tasks.retry(task.id)
      notify('success', 'Task restarted')
      await refreshTasks()
      navigate(`/chat/${handle.conversationId}`)
    } catch (error) {
      notify('error', 'Could not retry task', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const loadLogs = async (): Promise<void> => {
    setLogsLoading(true)
    try {
      setLogs(await window.igris.diagnostics.logs(250))
    } catch (error) {
      notify('error', 'Could not read logs', errorMessage(error))
    } finally {
      setLogsLoading(false)
    }
  }

  const exportLogs = async (): Promise<void> => {
    try {
      const result = await window.igris.diagnostics.export()
      notify(result.ok ? 'success' : 'info', 'Diagnostic export', result.message)
    } catch (error) {
      notify('error', 'Could not export diagnostics', errorMessage(error))
    }
  }

  const clearLogs = async (): Promise<void> => {
    setClearingLogs(true)
    try {
      await window.igris.diagnostics.clearLogs()
      setLogs([])
      setClearLogsOpen(false)
      notify('success', 'Diagnostic logs cleared')
    } catch (error) {
      notify('error', 'Could not clear logs', errorMessage(error))
    } finally {
      setClearingLogs(false)
    }
  }

  return (
    <div className="page activity-page">
      <PageHeader
        eyebrow="Audit trail"
        title="Activity"
        description="Every task, tool invocation, approval, and local diagnostic event in one accountable record."
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void (tab === 'logs' ? loadLogs() : refreshTasks())}>
              Refresh
            </Button>
            <Button variant="default" icon={<Download size={15} />} onClick={() => void exportLogs()}>
              Export diagnostics
            </Button>
          </>
        }
      />

      <div className="activity-stats">
        <div>
          <span className="activity-stat-dot is-total" />
          <strong>{stats.total}</strong>
          <span>total tasks</span>
        </div>
        <div>
          <span className="activity-stat-dot is-active" />
          <strong>{stats.active}</strong>
          <span>active now</span>
        </div>
        <div>
          <span className="activity-stat-dot is-success" />
          <strong>{stats.completed}</strong>
          <span>completed</span>
        </div>
        <div>
          <span className="activity-stat-dot is-error" />
          <strong>{stats.failed}</strong>
          <span>failed or stopped</span>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'tasks', label: 'Tasks', count: tasks.length },
          { value: 'logs', label: 'Diagnostic logs', count: logs.length }
        ]}
      />

      {tab === 'tasks' ? (
        <div className="activity-layout">
          <Card className="task-list-card">
            <div className="task-filter-row">
              {(
                [
                  ['all', 'All'],
                  ['active', 'Active'],
                  ['completed', 'Completed'],
                  ['failed', 'Failed'],
                  ['cancelled', 'Stopped']
                ] as Array<[TaskFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={clsx('filter-chip', filter === value && 'is-active')}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {filtered.length ? (
              <div className="task-list">
                {filtered.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={clsx('task-row', selectedId === task.id && 'is-active')}
                    onClick={() => setSelectedId(task.id)}
                  >
                    <span className={clsx('task-status-icon', `tone-${statusTone(task.status)}`)}>
                      <StatusIcon status={task.status} />
                    </span>
                    <span className="task-row-copy">
                      <strong>{task.title}</strong>
                      <small>
                        {task.kind.toUpperCase()} · {relativeTime(task.createdAt)}
                        {task.conversationId ? ' · linked conversation' : ''}
                      </small>
                    </span>
                    <span className="task-row-status">
                      <Badge tone={statusTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Clock3}
                title="No tasks in this view"
                description="Tasks appear here when IGRIS plans or runs something on your behalf."
              />
            )}
            <div className="task-list-foot">
              <span>{plural(filtered.length, 'task')} shown</span>
              <span>Latest 100 tasks</span>
            </div>
          </Card>

          <Card className="task-detail-card">
            {!selectedId ? (
              <EmptyState
                icon={FileJson}
                title="Select a task"
                description="Inspect its steps, tool calls, approvals, and result."
              />
            ) : detailLoading && !detail ? (
              <div className="detail-loading">
                <Spinner size={18} />
                Loading task…
              </div>
            ) : detail ? (
              <>
                <header className="task-detail-head">
                  <div>
                    <div className="eyebrow">Task detail</div>
                    <h2>{detail.task.title}</h2>
                    <div className="task-detail-meta">
                      <Badge tone={statusTone(detail.task.status)}>
                        {taskStatusLabel(detail.task.status)}
                      </Badge>
                      <span className="mono">{detail.task.id.slice(0, 8)}</span>
                      <span>Started {fullTime(detail.task.startedAt ?? detail.task.createdAt)}</span>
                      {detail.task.finishedAt ? (
                        <span>
                          {duration(
                            new Date(detail.task.finishedAt).getTime() -
                              new Date(detail.task.startedAt ?? detail.task.createdAt).getTime()
                          )}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="task-detail-actions">
                    {ACTIVE.has(detail.task.status) ? (
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Square size={12} />}
                        onClick={() => void cancelTask(detail.task)}
                        loading={busyId === detail.task.id}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {detail.task.status === 'failed' || detail.task.status === 'cancelled' ? (
                      <Button
                        variant="default"
                        size="sm"
                        icon={<RotateCcw size={13} />}
                        onClick={() => void retryTask(detail.task)}
                        loading={busyId === detail.task.id}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {detail.task.conversationId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/chat/${detail.task.conversationId}`)}
                      >
                        Open thread
                      </Button>
                    ) : null}
                  </div>
                </header>

                {detail.task.error ? (
                  <div className="task-error">
                    <XCircle size={14} />
                    {detail.task.error}
                  </div>
                ) : null}
                {detail.task.result ? (
                  <div className="task-result">
                    <span>Result</span>
                    <p>{detail.task.result}</p>
                  </div>
                ) : null}

                <div className="task-section">
                  <div className="task-section-head">
                    <h3>Steps</h3>
                    <Badge tone="neutral">{detail.steps.length}</Badge>
                  </div>
                  {detail.steps.length ? (
                    <div className="step-timeline">
                      {detail.steps.map((step) => (
                        <div key={step.id} className="step-row">
                          <span className={clsx('step-marker', `is-${step.status}`)}>
                            {step.status === 'completed' ? (
                              <Check size={10} />
                            ) : step.status === 'running' ? (
                              <Loader2 size={10} className="spin" />
                            ) : step.status === 'failed' ? (
                              <X size={10} />
                            ) : (
                              step.index + 1
                            )}
                          </span>
                          <div className="step-copy">
                            <strong>{step.title}</strong>
                            {step.detail ? <p>{step.detail}</p> : null}
                            <span>{fullTime(step.createdAt)}</span>
                          </div>
                          <Badge tone={step.status === 'completed' ? 'success' : step.status === 'failed' ? 'danger' : 'neutral'}>
                            {step.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="task-section-empty">No steps were recorded.</p>
                  )}
                </div>

                <div className="task-section">
                  <div className="task-section-head">
                    <h3>Tool calls</h3>
                    <Badge tone="neutral">{detail.toolRuns.length}</Badge>
                  </div>
                  {detail.toolRuns.length ? (
                    <div className="tool-run-list">
                      {detail.toolRuns.map((run) => (
                        <div key={run.id} className={clsx('tool-run', run.status === 'failed' && 'is-failed')}>
                          <div className="tool-run-head">
                            <code>{run.toolName}</code>
                            <Badge
                              tone={
                                run.status === 'completed'
                                  ? 'success'
                                  : run.status === 'failed'
                                    ? 'danger'
                                    : run.status === 'awaiting_confirmation'
                                      ? 'warning'
                                      : 'neutral'
                              }
                            >
                              {run.status.replace(/_/g, ' ')}
                            </Badge>
                            <span className="tool-run-approval">
                              {run.approval === 'not_required'
                                ? 'No approval'
                                : `Approval: ${run.approval}`}
                            </span>
                            {run.finishedAt ? (
                              <span className="tool-run-time">{fullTime(run.finishedAt)}</span>
                            ) : null}
                          </div>
                          {run.argsJson ? (
                            <pre className="tool-run-args">{run.argsJson}</pre>
                          ) : null}
                          {run.error ? <p className="tool-run-error">{run.error}</p> : null}
                          {run.result ? <p className="tool-run-result">{run.result}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="task-section-empty">No tools were invoked.</p>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                icon={XCircle}
                title="Task unavailable"
                description="The local record could not be read."
              />
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'logs' ? (
        <Card className="logs-card">
          <div className="logs-head">
            <div>
              <h2>Local diagnostic log</h2>
              <p>Scoped runtime events. Secrets and file contents are redacted before writing.</p>
            </div>
            <div className="logs-actions">
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={13} />}
                onClick={() => void loadLogs()}
                loading={logsLoading}
              >
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={() => setClearLogsOpen(true)}
                disabled={!logs.length}
              >
                Clear
              </Button>
            </div>
          </div>
          {logsLoading && !logs.length ? (
            <div className="table-loading">
              <Spinner size={16} /> Reading logs…
            </div>
          ) : logs.length ? (
            <div className="log-list">
              <div className="log-row log-head">
                <span>Time</span>
                <span>Level</span>
                <span>Scope</span>
                <span>Message</span>
              </div>
              {logs.map((log) => (
                <div key={log.id} className={clsx('log-row', `is-${log.level}`)}>
                  <span className="log-time">{fullTime(log.createdAt)}</span>
                  <span className="log-level">{log.level.toUpperCase()}</span>
                  <span className="log-scope">{log.scope}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="No diagnostic events"
              description="The log is empty. Diagnostics can be disabled entirely in Settings → Privacy."
            />
          )}
          <div className="logs-foot">
            <span>{plural(logs.length, 'entry', 'entries')} loaded</span>
            <span>Stored in the local SQLite database</span>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={clearLogsOpen}
        title="Clear all diagnostic logs?"
        description="Runtime events will be permanently removed. Conversation history is not affected."
        confirmLabel="Clear logs"
        busy={clearingLogs}
        onCancel={() => setClearLogsOpen(false)}
        onConfirm={() => void clearLogs()}
      />
    </div>
  )
}

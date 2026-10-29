import type { Task, TaskDetail, TaskStatus, TaskStep, ToolRun } from '@shared/types'
import type { TaskRepository } from '../storage/repositories'
import { AppError } from '../security/errors'
import { assertTransition, TERMINAL_STATUSES } from './state'

export class TaskService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly onChange: (taskId: string) => void
  ) {}

  create(input: {
    title: string
    kind: Task['kind']
    conversationId?: string | null
    runId?: string | null
    input?: unknown
  }): Task {
    const task = this.repo.create(input)
    this.onChange(task.id)
    return task
  }

  get(id: string): Task {
    const task = this.repo.get(id)
    if (!task) throw new AppError('NOT_FOUND', 'Task not found.')
    return task
  }

  detail(id: string): TaskDetail {
    const detail = this.repo.detail(id)
    if (!detail) throw new AppError('NOT_FOUND', 'Task not found.')
    return detail
  }

  list(limit = 100, status?: string): Task[] {
    return this.repo.list(limit, status)
  }

  setStatus(
    taskId: string,
    status: TaskStatus,
    patch: { error?: string | null; result?: string | null } = {}
  ): Task {
    const task = this.get(taskId)
    assertTransition(task.status, status)
    const now = new Date().toISOString()
    const startedAt =
      task.startedAt ?? (status === 'planning' || status === 'running' ? now : null)
    const finishedAt = TERMINAL_STATUSES.includes(status)
      ? (task.finishedAt ?? now)
      : null
    this.repo.update(taskId, {
      status,
      startedAt,
      finishedAt,
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.result !== undefined ? { result: patch.result } : {})
    })
    this.onChange(taskId)
    return this.get(taskId)
  }

  addStep(taskId: string, title: string, detail: string | null = null): TaskStep {
    const step = this.repo.addStep(taskId, title, detail)
    this.onChange(taskId)
    return step
  }

  finishStep(stepId: string, status: TaskStep['status'], detail: string | null = null): void {
    this.repo.updateStep(stepId, status, detail)
  }

  addToolRun(input: Parameters<TaskRepository['addToolRun']>[0]): ToolRun {
    const run = this.repo.addToolRun(input)
    this.onChange(input.taskId)
    return run
  }

  updateToolRun(id: string, patch: Parameters<TaskRepository['updateToolRun']>[1]): void {
    this.repo.updateToolRun(id, patch)
  }

  requestCancel(taskId: string): void {
    this.repo.requestCancel(taskId)
    this.onChange(taskId)
  }

  isCancelRequested(taskId: string): boolean {
    return this.repo.isCancelRequested(taskId)
  }

  getInput(taskId: string): unknown {
    return this.repo.getInput(taskId)
  }

  pendingCount(): number {
    return this.repo.pendingCount()
  }

  markInterrupted(): void {
    this.repo.markInterrupted()
  }
}

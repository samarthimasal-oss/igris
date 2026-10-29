import type { TaskStatus } from '@shared/types'
import { AppError } from '../security/errors'

export const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled']

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  queued: ['planning', 'running', 'failed', 'cancelled'],
  planning: ['running', 'awaiting_confirmation', 'failed', 'cancelled'],
  awaiting_confirmation: ['running', 'failed', 'cancelled'],
  running: ['awaiting_confirmation', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true
  return ALLOWED[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('INTERNAL', `Invalid task transition from ${from} to ${to}.`)
  }
}

import { describe, expect, it } from 'vitest'
import { assertTransition, canTransition, TERMINAL_STATUSES } from '../../src/main/tasks/state'
import type { TaskStatus } from '../../src/shared/types'

const STATUSES: TaskStatus[] = [
  'queued',
  'planning',
  'awaiting_confirmation',
  'running',
  'completed',
  'failed',
  'cancelled'
]

describe('task state machine', () => {
  it('allows the normal planning path', () => {
    expect(canTransition('queued', 'planning')).toBe(true)
    expect(canTransition('planning', 'awaiting_confirmation')).toBe(true)
    expect(canTransition('awaiting_confirmation', 'running')).toBe(true)
    expect(canTransition('running', 'completed')).toBe(true)
  })

  it('treats a transition to the same status as a no-op', () => {
    for (const status of STATUSES) expect(canTransition(status, status)).toBe(true)
  })

  it('never leaves a terminal status', () => {
    for (const status of TERMINAL_STATUSES) {
      for (const next of STATUSES) {
        if (next === status) continue
        expect(canTransition(status, next)).toBe(false)
      }
    }
  })

  it('allows cancellation from every active status', () => {
    for (const status of ['queued', 'planning', 'awaiting_confirmation', 'running'] as TaskStatus[]) {
      expect(canTransition(status, 'cancelled')).toBe(true)
      expect(canTransition(status, 'failed')).toBe(true)
    }
  })

  it('does not skip from queued directly to completed', () => {
    expect(canTransition('queued', 'completed')).toBe(false)
  })

  it('throws a structured error for invalid transitions', () => {
    expect(() => assertTransition('completed', 'running')).toThrowError(
      /Invalid task transition from completed to running/
    )
  })
})

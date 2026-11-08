import { randomUUID } from 'node:crypto'
import type {
  ControlScope,
  ControlSessionState,
  ControlStatus
} from '@shared/types'
import { AppError } from '../security/errors'

export interface ControlSession {
  id: string
  taskId: string
  goal: string
  scope: ControlScope
  startedAt: number
  expiresAt: number
  paused: boolean
  stopped: boolean
  endedAt: number | null
  endReason: string | null
  currentAction: string | null
  actions: number
  maxActions: number
  turns: number
  maxTurns: number
}

export interface ControlSessionLimits {
  ttlMs?: number
  maxActions?: number
  maxTurns?: number
}

export type ControlStateListener = (state: ControlSessionState | null) => void

const DEFAULT_LIMITS: Required<ControlSessionLimits> = {
  ttlMs: 20 * 60_000,
  maxActions: 120,
  maxTurns: 30
}

function scopeAllows(approved: ControlScope, needed: ControlScope): boolean {
  if (approved === 'both') return true
  return approved === needed
}

/**
 * Task-scoped control authorization. The model never receives a token; the
 * session is looked up from the task ID supplied by the runtime.
 */
export class ControlSessionService {
  private readonly sessions = new Map<string, ControlSession>()
  private readonly listeners = new Set<ControlStateListener>()
  private readonly limits: Required<ControlSessionLimits>

  constructor(
    private readonly now: () => number = Date.now,
    limits: ControlSessionLimits = {}
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
  }

  create(taskId: string, goal: string, scope: ControlScope): ControlSessionState {
    this.expireDue()
    const existing = this.sessions.get(taskId)
    if (existing && !existing.stopped && existing.endedAt === null) {
      return this.toState(existing)
    }
    if (existing) this.sessions.delete(taskId)

    const startedAt = this.now()
    const session: ControlSession = {
      id: randomUUID(),
      taskId,
      goal: goal.trim().slice(0, 500) || 'Computer control',
      scope,
      startedAt,
      expiresAt: startedAt + this.limits.ttlMs,
      paused: false,
      stopped: false,
      endedAt: null,
      endReason: null,
      currentAction: null,
      actions: 0,
      maxActions: this.limits.maxActions,
      turns: 0,
      maxTurns: this.limits.maxTurns
    }
    this.sessions.set(taskId, session)
    this.emit(session)
    return this.toState(session)
  }

  getForTask(taskId: string): ControlSession | null {
    this.expireDue()
    return this.sessions.get(taskId) ?? null
  }

  stateForTask(taskId: string): ControlSessionState | null {
    this.expireDue()
    const session = this.sessions.get(taskId)
    if (!session || session.stopped || session.endedAt !== null) return null
    return this.toState(session)
  }

  activeStates(): ControlSessionState[] {
    this.expireDue()
    return [...this.sessions.values()]
      .filter((session) => !session.stopped && session.endedAt === null)
      .map((session) => this.toState(session))
  }

  activeState(): ControlSessionState | null {
    const states = this.activeStates()
    return states.length ? states[0]! : null
  }

  activeForTask(taskId: string): boolean {
    return this.stateForTask(taskId) !== null
  }

  assertActive(taskId: string, needed: ControlScope): ControlSession {
    this.expireDue()
    const session = this.sessions.get(taskId)
    if (!session) {
      throw new AppError(
        'PERMISSION',
        'No computer-control session is active for this task. Call request_computer_control and wait for the user to approve it.'
      )
    }
    if (session.endedAt !== null) {
      if (session.endReason === 'expired') {
        throw new AppError(
          'PERMISSION',
          'The computer-control session expired. Ask the user to approve control again.'
        )
      }
      throw new AppError(
        'PERMISSION',
        'Computer control was stopped for this task. Ask the user before requesting it again.'
      )
    }
    if (session.stopped) {
      throw new AppError(
        'PERMISSION',
        'Computer control was stopped for this task. Ask the user before requesting it again.'
      )
    }
    if (this.now() >= session.expiresAt) {
      this.expire(session, 'expired')
      throw new AppError(
        'PERMISSION',
        'The computer-control session expired. Ask the user to approve control again.'
      )
    }
    if (session.paused) {
      throw new AppError(
        'PERMISSION',
        'Computer control is paused. Ask the user to resume it from the control bar.'
      )
    }
    if (!scopeAllows(session.scope, needed)) {
      throw new AppError(
        'PERMISSION',
        `This control session is approved for ${session.scope} only; it cannot perform ${needed} actions. Start a new task with the right scope.`
      )
    }
    if (session.actions >= session.maxActions) {
      session.paused = true
      this.emit(session)
      throw new AppError(
        'PERMISSION',
        `The control session reached its ${session.maxActions}-action budget and paused. Ask the user to resume with a new task.`
      )
    }
    return session
  }

  recordAction(taskId: string, action: string): ControlSessionState {
    const session = this.assertActive(taskId, this.scopeForTask(taskId))
    session.actions += 1
    session.currentAction = action.trim().slice(0, 200) || null
    this.emit(session)
    return this.toState(session)
  }

  recordTurn(taskId: string): ControlSessionState {
    const session = this.assertActive(taskId, this.scopeForTask(taskId))
    session.turns += 1
    if (session.turns > session.maxTurns) {
      session.paused = true
      this.emit(session)
      throw new AppError(
        'PERMISSION',
        `The control session reached its ${session.maxTurns}-turn budget and paused. Ask the user to resume with a new task.`
      )
    }
    return this.toState(session)
  }

  pause(taskId?: string): boolean {
    this.expireDue()
    const session = taskId ? this.sessions.get(taskId) : this.firstActive()
    if (!session || session.stopped || session.endedAt !== null) return false
    session.paused = true
    this.emit(session)
    return true
  }

  resume(taskId?: string): boolean {
    this.expireDue()
    const session = taskId ? this.sessions.get(taskId) : this.firstActive()
    if (!session || session.stopped || session.endedAt !== null) return false
    if (this.now() >= session.expiresAt) {
      this.expire(session, 'expired')
      return false
    }
    session.paused = false
    this.emit(session)
    return true
  }

  stop(taskId?: string, reason = 'user'): boolean {
    this.expireDue()
    const session = taskId ? this.sessions.get(taskId) : this.firstActive()
    if (!session || session.stopped || session.endedAt !== null) return false
    session.stopped = true
    session.paused = false
    session.currentAction = null
    session.endedAt = this.now()
    session.endReason = reason
    this.emit(null)
    return true
  }

  endTask(taskId: string, reason = 'task finished'): boolean {
    const session = this.sessions.get(taskId)
    if (!session) return false
    this.sessions.delete(taskId)
    if (!session.stopped && session.endedAt === null) {
      session.endedAt = this.now()
      session.endReason = reason
      this.emit(null)
    }
    return true
  }

  endAll(reason = 'app quit'): void {
    for (const session of [...this.sessions.values()]) {
      if (session.stopped || session.endedAt !== null) {
        this.sessions.delete(session.taskId)
        continue
      }
      session.stopped = true
      session.currentAction = null
      session.endedAt = this.now()
      session.endReason = reason
      this.sessions.delete(session.taskId)
      this.emit(null)
    }
  }

  onChange(listener: ControlStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private firstActive(): ControlSession | null {
    this.expireDue()
    for (const session of this.sessions.values()) {
      if (!session.stopped && session.endedAt === null) return session
    }
    return null
  }

  private scopeForTask(taskId: string): ControlScope {
    return this.sessions.get(taskId)?.scope ?? 'both'
  }

  private expireDue(): void {
    for (const session of this.sessions.values()) {
      if (!session.stopped && session.endedAt === null && this.now() >= session.expiresAt) {
        this.expire(session, 'expired')
      }
    }
  }

  private expire(session: ControlSession, reason: string): void {
    session.stopped = false
    session.endedAt = this.now()
    session.endReason = reason
    session.currentAction = null
    this.emit(null)
  }

  private toState(session: ControlSession): ControlSessionState {
    let status: ControlStatus = 'active'
    if (session.stopped) status = 'stopped'
    else if (session.endedAt !== null) status = 'expired'
    else if (session.paused) status = 'paused'
    return {
      id: session.id,
      goal: session.goal,
      scope: session.scope,
      status,
      currentAction: session.currentAction ?? null,
      actions: session.actions,
      maxActions: session.maxActions,
      startedAt: new Date(session.startedAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString()
    }
  }

  private emit(session: ControlSession | null): void {
    const state = session
      ? session.stopped || session.endedAt !== null
        ? null
        : this.toState(session)
      : null
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch {
        // A HUD or renderer listener must never break the control path.
      }
    }
  }
}

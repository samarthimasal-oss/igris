import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/security/errors'
import { ControlSessionService } from '../../src/main/control/sessionService'
import type { ControlSessionState } from '../../src/shared/types'

function makeService(start = 1_700_000_000_000) {
  let now = start
  const service = new ControlSessionService(() => now, {
    ttlMs: 20 * 60_000,
    maxActions: 120,
    maxTurns: 30
  })
  const events: Array<ControlSessionState | null> = []
  service.onChange((state) => events.push(state))
  return {
    service,
    events,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('ControlSessionService', () => {
  it('creates an active session bound to the task and scope', () => {
    const { service } = makeService()
    const state = service.create('task-1', 'Open Notepad and type a haiku', 'desktop')
    expect(state.status).toBe('active')
    expect(state.goal).toBe('Open Notepad and type a haiku')
    expect(state.scope).toBe('desktop')
    expect(state.actions).toBe(0)
    expect(state.maxActions).toBe(120)
    expect(Date.parse(state.expiresAt) - Date.parse(state.startedAt)).toBe(20 * 60_000)
    expect(service.getForTask('task-1')?.id).toBe(state.id)
  })

  it('is idempotent for the same task', () => {
    const { service } = makeService()
    const first = service.create('task-1', 'One goal', 'desktop')
    const second = service.create('task-1', 'Another goal', 'both')
    expect(second.id).toBe(first.id)
    expect(service.stateForTask('task-1')?.goal).toBe('One goal')
  })

  it('rejects actions without a session', () => {
    const { service } = makeService()
    expect(() => service.assertActive('missing', 'desktop')).toThrow(AppError)
  })

  it('enforces the approved scope', () => {
    const { service } = makeService()
    service.create('task-1', 'Browse', 'browser')
    expect(service.assertActive('task-1', 'browser').id).toBeTruthy()
    expect(() => service.assertActive('task-1', 'desktop')).toThrow(/desktop/i)
  })

  it('expires after the ttl and notifies the hud', () => {
    const { service, events, advance } = makeService()
    service.create('task-1', 'Long task', 'both')
    advance(20 * 60_000 + 1)
    expect(service.stateForTask('task-1')).toBeNull()
    expect(() => service.assertActive('task-1', 'desktop')).toThrow(/expired/i)
    expect(events.at(-1)).toBeNull()
  })

  it('pauses and resumes without losing the session', () => {
    const { service } = makeService()
    service.create('task-1', 'Pause test', 'desktop')
    expect(service.pause('task-1')).toBe(true)
    expect(service.stateForTask('task-1')?.status).toBe('paused')
    expect(() => service.assertActive('task-1', 'desktop')).toThrow(/paused/i)
    expect(service.resume('task-1')).toBe(true)
    expect(service.assertActive('task-1', 'desktop').paused).toBe(false)
  })

  it('stops immediately and is idempotent', () => {
    const { service } = makeService()
    service.create('task-1', 'Stop test', 'desktop')
    expect(service.stop('task-1', 'user')).toBe(true)
    expect(service.stateForTask('task-1')).toBeNull()
    expect(() => service.assertActive('task-1', 'desktop')).toThrow(/stopped/i)
    expect(service.stop('task-1')).toBe(false)
  })

  it('ends with the task', () => {
    const { service } = makeService()
    service.create('task-1', 'End test', 'desktop')
    expect(service.endTask('task-1', 'completed')).toBe(true)
    expect(service.stateForTask('task-1')).toBeNull()
  })

  it('tracks actions and enforces the action budget', () => {
    const { service } = makeService()
    service.create('task-1', 'Budget test', 'desktop')
    service.recordAction('task-1', 'Focused Notepad')
    expect(service.stateForTask('task-1')?.actions).toBe(1)
    expect(service.stateForTask('task-1')?.currentAction).toBe('Focused Notepad')
    for (let index = 1; index < 120; index += 1) {
      service.recordAction('task-1', `Action ${index}`)
    }
    expect(() => service.recordAction('task-1', 'Action 121')).toThrow(/budget/i)
    expect(service.stateForTask('task-1')?.status).toBe('paused')
  })

  it('tracks model turns and enforces the turn budget', () => {
    const { service } = makeService()
    service.create('task-1', 'Turn test', 'desktop')
    for (let index = 0; index < 30; index += 1) service.recordTurn('task-1')
    expect(() => service.recordTurn('task-1')).toThrow(/turn/i)
  })

  it('ends every session on shutdown', () => {
    const { service } = makeService()
    service.create('task-1', 'One', 'desktop')
    service.create('task-2', 'Two', 'browser')
    service.endAll('app quit')
    expect(service.stateForTask('task-1')).toBeNull()
    expect(service.stateForTask('task-2')).toBeNull()
  })
})

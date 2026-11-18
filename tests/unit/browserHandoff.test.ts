import { describe, expect, it } from 'vitest'
import { ChatEngine } from '../../src/main/ai/chatEngine'
import { BrowserService } from '../../src/main/control/browserService'
import { createToolRegistry } from '../../src/main/tools/registry'

interface FakeSession {
  paused: boolean
  stopped: boolean
  endedAt: number | null
}

interface FakeEvent {
  type: string
  status?: string
  detail?: string
}

interface FakeStep {
  id: string
  title: string
  detail: string | null
}

function makeService(pausedTasks: string[], canPause = true): BrowserService {
  return new BrowserService({
    sessions: {
      pause: (taskId: string) => {
        pausedTasks.push(taskId)
        return canPause
      }
    },
    profileDir: 'C:/tmp/igris-test-profile',
    logger: { info: () => {}, warn: () => {} },
    encodeScreenshot: async () => null
  } as never)
}

function handoff(
  service: BrowserService,
  reason?: string
): { text: string; display?: string } {
  return (
    service as unknown as {
      handoff: (
        taskId: string,
        args: { action: string; reason?: string }
      ) => { text: string; display?: string }
    }
  ).handoff('task-1', { action: 'handoff', ...(reason ? { reason } : {}) })
}

function makeEngine(
  session: FakeSession | null,
  options: { cancelRequested?: boolean; events?: FakeEvent[]; steps?: FakeStep[]; finished?: string[] } = {}
): ChatEngine {
  const events = options.events ?? []
  const steps = options.steps ?? []
  const finished = options.finished ?? []
  return new ChatEngine({
    tasks: {
      setStatus: () => {},
      addStep: (_taskId: string, title: string, detail: string | null) => {
        const step = { id: `step-${steps.length + 1}`, title, detail }
        steps.push(step)
        return step
      },
      finishStep: (id: string, status: string) => finished.push(`${id}:${status}`),
      isCancelRequested: () => options.cancelRequested ?? false
    },
    control: { getForTask: () => session },
    emit: (event: FakeEvent) => events.push(event)
  } as never)
}

function makeActive(): {
  controller: AbortController
  runId: string
  taskId: string
  conversationId: string
  finished: boolean
  deadline: NodeJS.Timeout | null
} {
  return {
    controller: new AbortController(),
    runId: 'run-1',
    taskId: 'task-1',
    conversationId: 'c1',
    finished: false,
    deadline: null
  }
}

async function gate(engine: ChatEngine, active: unknown, reason = 'Enter the code') {
  const call = (
    engine as unknown as {
      handoffGate: (
        active: unknown,
        reason: string
      ) => Promise<{ text: string; display: string }>
    }
  ).handoffGate.bind(engine)
  return call(active, reason)
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('browser handoff', () => {
  it('pauses the task control session and records the reason', () => {
    const paused: string[] = []
    const result = handoff(makeService(paused), 'Enter the verification code')
    expect(paused).toEqual(['task-1'])
    expect(result.text).toContain('Handoff: Enter the verification code')
    expect(result.text).toContain('paused')
    expect(result.text).toContain('Resume')
    expect(result.display).toBe('Waiting for the user (handoff)')
  })

  it('uses a default reason and reports when no session could be paused', () => {
    const paused: string[] = []
    const result = handoff(makeService(paused, false))
    expect(paused).toEqual(['task-1'])
    expect(result.text).toContain('only the user can complete')
    expect(result.text).toContain('nothing was paused')
  })

  it('exposes handoff and reason in the browser tool schema', () => {
    const registry = createToolRegistry({} as never)
    const browser = registry.providerTools().find((tool) => tool.name === 'browser')
    const parameters = browser?.parameters as {
      properties: Record<string, Record<string, unknown>>
    }
    expect(parameters.properties.action.enum).toContain('handoff')
    expect(parameters.properties.reason.type).toBe('string')
  })

  it('holds the run until the user resumes, then reports that control returned', async () => {
    const session: FakeSession = { paused: true, stopped: false, endedAt: null }
    const events: FakeEvent[] = []
    const steps: FakeStep[] = []
    const finished: string[] = []
    const engine = makeEngine(session, { events, steps, finished })
    const active = makeActive()

    let settled = false
    const running = gate(engine, active).finally(() => {
      settled = true
    })

    await wait(80)
    expect(settled).toBe(false)
    expect(steps.map((step) => step.title)).toEqual(['Waiting for the user'])
    expect(steps[0].detail).toBe('Enter the code')
    expect(events.some((event) => event.detail?.includes('Waiting for the user'))).toBe(true)

    session.paused = false
    const result = await running
    expect(result.text).toContain('resumed control')
    expect(result.text).toContain('snapshot')
    expect(finished).toEqual(['step-1:completed'])
    expect(active.deadline).not.toBeNull()
    if (active.deadline) clearTimeout(active.deadline)
  })

  it('ends the wait when the user stops control or the session ends', async () => {
    const stopped: FakeSession = { paused: true, stopped: true, endedAt: null }
    const engine = makeEngine(stopped)
    const result = await gate(engine, makeActive())
    expect(result.text).toContain('ended during the handoff')
    expect(result.text).toContain('Do not call browser or desktop tools')

    const ended = makeEngine({ paused: true, stopped: false, endedAt: 1 })
    expect((await gate(ended, makeActive())).text).toContain('ended during the handoff')
  })

  it('releases the wait through abort and cancels the task on a cancel request', async () => {
    const session: FakeSession = { paused: true, stopped: false, endedAt: null }
    const engine = makeEngine(session)
    const active = makeActive()
    const running = gate(engine, active)
    await wait(50)
    active.controller.abort()
    await expect(running).rejects.toThrow('cancelled')
    if (active.deadline) clearTimeout(active.deadline)

    const cancelActive = makeActive()
    const cancelling = makeEngine(session, { cancelRequested: true })
    await expect(gate(cancelling, cancelActive)).rejects.toThrow('cancelled')
    expect(cancelActive.controller.signal.aborted).toBe(true)
    if (cancelActive.deadline) clearTimeout(cancelActive.deadline)
  })
})

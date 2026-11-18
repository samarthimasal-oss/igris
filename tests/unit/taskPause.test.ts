import { describe, expect, it } from 'vitest'
import { ChatEngine } from '../../src/main/ai/chatEngine'

interface TaskFake {
  statuses: string[]
  steps: string[]
  cancelRequested: boolean
}

interface ChatEventFake {
  type: string
  status?: string
}

function makeEngine(
  task: TaskFake,
  events: ChatEventFake[] = []
): ChatEngine {
  return new ChatEngine({
    tasks: {
      setStatus: (_taskId: string, status: string) => task.statuses.push(status),
      addStep: (_taskId: string, title: string) => {
        task.steps.push(title)
        return { id: 'step-1' }
      },
      isCancelRequested: () => task.cancelRequested
    },
    emit: (event: ChatEventFake) => events.push(event)
  } as never)
}

function makeActive(): {
  controller: AbortController
  runId: string
  taskId: string
  conversationId: string
} {
  return {
    controller: new AbortController(),
    runId: 'run-1',
    taskId: 'task-1',
    conversationId: 'c1'
  }
}

function priv(engine: ChatEngine) {
  return engine as unknown as {
    pauseGate: (active: unknown) => Promise<void>
    pauseTask: (taskId: string) => boolean
    resumeTask: (taskId: string) => boolean
    runsByTask: Map<string, string>
    pausedTasks: Set<string>
  }
}

function freshTask(): TaskFake {
  return { statuses: [], steps: [], cancelRequested: false }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('task pause and resume', () => {
  it('only pauses tasks that have an active run, and resume is one-shot', () => {
    const engine = makeEngine(freshTask())
    const p = priv(engine)

    expect(p.pauseTask('task-1')).toBe(false)
    p.runsByTask.set('task-1', 'run-1')
    expect(p.pauseTask('task-1')).toBe(true)
    expect(p.pauseTask('task-1')).toBe(true)
    expect(p.resumeTask('task-1')).toBe(true)
    expect(p.resumeTask('task-1')).toBe(false)
  })

  it('does not touch the task when no pause was requested', async () => {
    const task = freshTask()
    const engine = makeEngine(task)

    await priv(engine).pauseGate(makeActive())
    expect(task.statuses).toEqual([])
    expect(task.steps).toEqual([])
  })

  it('blocks at the checkpoint while paused and resumes when released', async () => {
    const task = freshTask()
    const events: ChatEventFake[] = []
    const engine = makeEngine(task, events)
    const p = priv(engine)
    p.runsByTask.set('task-1', 'run-1')
    p.pauseTask('task-1')

    let settled = false
    const gate = p.pauseGate(makeActive()).finally(() => {
      settled = true
    })

    await wait(60)
    expect(settled).toBe(false)
    expect(task.statuses).toEqual(['paused'])
    expect(task.steps).toEqual(['Paused by the user'])
    expect(events.some((event) => event.status === 'paused')).toBe(true)

    p.resumeTask('task-1')
    await gate
    expect(task.statuses).toEqual(['paused', 'running'])
    expect(task.steps).toEqual(['Paused by the user', 'Resumed by the user'])
    expect(events.some((event) => event.status === 'thinking')).toBe(true)
  })

  it('cancels a paused run through the abort signal and clears the marker', async () => {
    const task = freshTask()
    const engine = makeEngine(task)
    const p = priv(engine)
    p.runsByTask.set('task-1', 'run-1')
    p.pauseTask('task-1')
    const active = makeActive()

    const gate = p.pauseGate(active)
    await wait(60)
    active.controller.abort()
    await expect(gate).rejects.toThrow('cancelled')
    expect(p.pausedTasks.has('task-1')).toBe(false)
  })

  it('honours a cancel request even without an abort, aborting the controller', async () => {
    const task = freshTask()
    task.cancelRequested = true
    const engine = makeEngine(task)
    const p = priv(engine)
    p.runsByTask.set('task-1', 'run-1')
    p.pauseTask('task-1')
    const active = makeActive()

    const gate = p.pauseGate(active)
    await expect(gate).rejects.toThrow('cancelled')
    expect(active.controller.signal.aborted).toBe(true)
    expect(p.pausedTasks.has('task-1')).toBe(false)
  })
})

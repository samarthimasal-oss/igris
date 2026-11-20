import { describe, expect, it } from 'vitest'
import { createToolRegistry } from '../../src/main/tools/registry'
import type { TaskPlan } from '@shared/types'

function makeRegistry(tasks: { savePlan: (taskId: string, plan: TaskPlan) => void }) {
  return createToolRegistry({
    workspaces: { list: () => [] },
    files: {},
    terminal: {},
    apps: { list: () => [] },
    screen: { status: () => ({ available: false, detail: '' }) },
    browser: {},
    control: {},
    desktop: {},
    managedBrowser: {},
    memories: { list: () => [], add: () => ({ id: 'm1' }) },
    tasks,
    settings: () => ({}) as never,
    logger: { warn: () => undefined, info: () => undefined }
  } as never)
}

const CONTEXT = {
  taskId: 'task-1',
  signal: new AbortController().signal,
  confirm: async () => true
}

describe('plan_task tool', () => {
  it('records the plan with pending steps on the task', async () => {
    const saved: Array<{ taskId: string; plan: TaskPlan }> = []
    const registry = makeRegistry({
      savePlan: (taskId, plan) => saved.push({ taskId, plan })
    })
    const tool = registry.get('plan_task')
    expect(tool).toBeTruthy()

    const outcome = await tool!.run(
      {
        steps: ['Check the player state', 'Press play', 'Verify playback is advancing'],
        risks: 'none'
      },
      CONTEXT
    )
    expect(outcome.text).toContain('Plan recorded with 3 steps')
    expect(saved).toHaveLength(1)
    expect(saved[0]?.taskId).toBe('task-1')
    expect(saved[0]?.plan.steps).toHaveLength(3)
    expect(saved[0]?.plan.steps.every((step) => step.status === 'pending')).toBe(true)
    expect(saved[0]?.plan.risks).toBe('none')
  })

  it('rejects empty plans and overlong step lists', async () => {
    const registry = makeRegistry({ savePlan: () => undefined })
    const tool = registry.get('plan_task')!
    await expect(tool.run({ steps: ['ok'] }, CONTEXT)).rejects.toThrow()
    await expect(
      tool.run({ steps: Array.from({ length: 13 }, (_, i) => `step ${i + 1}`) }, CONTEXT)
    ).rejects.toThrow()
  })
})

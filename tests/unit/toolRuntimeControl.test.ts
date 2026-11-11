import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { ConfirmationRequest, Settings } from '../../src/shared/types'
import { ToolRuntime } from '../../src/main/tools/toolRuntime'
import type { ToolDefinition } from '../../src/main/tools/registry'

function makeTasks() {
  return {
    runs: [] as string[],
    addToolRun() {
      const id = `run-${this.runs.length + 1}`
      this.runs.push(id)
      return { id }
    },
    updateToolRun: () => undefined,
    setStatus: () => undefined,
    addStep: () => ({ id: 'step-1' }),
    finishStep: () => undefined,
    isCancelRequested: () => false
  }
}

function makeRuntime(
  tool: ToolDefinition,
  overrides: { settings?: Partial<Settings>; confirmations?: boolean[] } = {}
) {
  const tasks = makeTasks()
  const confirmations = overrides.confirmations ?? []
  const requests: ConfirmationRequest[] = []
  let index = 0
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...overrides.settings,
    ai: { ...DEFAULT_SETTINGS.ai, ...overrides.settings?.ai }
  }
  const runtime = new ToolRuntime(
    (id) => (id === tool.id ? tool : undefined),
    tasks as never,
    () => settings,
    { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined } as never
  )
  return { runtime, requests, tasks, confirm: async (request: ConfirmationRequest) => {
    requests.push(request)
    const answer = confirmations[index] ?? false
    index += 1
    return answer
  } }
}

function controlTool(
  overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'run'>
): ToolDefinition {
  return {
    id: 'desktop',
    title: 'Control the desktop',
    description: 'Test tool',
    category: 'computer',
    risk: 'high',
    permission: null,
    requiresConfirmation: false,
    timeoutMs: 5000,
    schema: { safeParse: () => ({ success: true, data: {} }) } as never,
    jsonSchema: {},
    parseArgs: () => ({}),
    ...overrides
  }
}

describe('ToolRuntime control confirmations', () => {
  it('forces approval for request_computer_control even when confirmations are off', async () => {
    let ran = false
    const tool = controlTool({
      id: 'request_computer_control',
      requiresConfirmation: true,
      forceConfirmation: true,
      run: async () => {
        ran = true
        return { text: 'created' }
      }
    })
    const { runtime, requests, confirm } = makeRuntime(tool, {
      settings: { ai: { ...DEFAULT_SETTINGS.ai, confirmSensitiveActions: false } },
      confirmations: [true]
    })
    const result = await runtime.invoke({
      toolName: tool.id,
      callId: 'call-1',
      args: {},
      taskId: 'task-1',
      signal: new AbortController().signal,
      hooks: { requestConfirmation: confirm, onToolEvent: () => undefined }
    })
    expect(requests).toHaveLength(1)
    expect(ran).toBe(true)
    expect(result.ok).toBe(true)
  })

  it('does not prompt for ordinary confirmed tools when confirmations are off', async () => {
    const tool = controlTool({
      requiresConfirmation: true,
      run: async () => ({ text: 'ok' })
    })
    const { runtime, requests, confirm } = makeRuntime(tool, {
      settings: { ai: { ...DEFAULT_SETTINGS.ai, confirmSensitiveActions: false } }
    })
    await runtime.invoke({
      toolName: tool.id,
      callId: 'call-1',
      args: {},
      taskId: 'task-1',
      signal: new AbortController().signal,
      hooks: { requestConfirmation: confirm, onToolEvent: () => undefined }
    })
    expect(requests).toHaveLength(0)
  })

  it('exposes a mid-action confirm gate that always asks the user', async () => {
    const tool = controlTool({
      run: async (_args, context) => {
        const approved = await context.confirm({
          title: 'Close "Untitled - Notepad"?',
          description: 'Unsaved work could be lost.',
          risk: 'high'
        })
        return { text: approved ? 'closed' : 'declined', denied: !approved }
      }
    })
    const { runtime, requests, confirm } = makeRuntime(tool, {
      settings: { ai: { ...DEFAULT_SETTINGS.ai, confirmSensitiveActions: false } },
      confirmations: [false]
    })
    const result = await runtime.invoke({
      toolName: tool.id,
      callId: 'call-1',
      args: {},
      taskId: 'task-1',
      signal: new AbortController().signal,
      hooks: { requestConfirmation: confirm, onToolEvent: () => undefined }
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.title).toMatch(/close/i)
    expect(requests[0]?.toolName).toBe('desktop')
    expect(result.denied).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('returns a denial result without running the tool when approval is declined', async () => {
    let ran = false
    const tool = controlTool({
      id: 'request_computer_control',
      requiresConfirmation: true,
      forceConfirmation: true,
      run: async () => {
        ran = true
        return { text: 'created' }
      }
    })
    const { runtime, confirm } = makeRuntime(tool, { confirmations: [false] })
    const result = await runtime.invoke({
      toolName: tool.id,
      callId: 'call-1',
      args: {},
      taskId: 'task-1',
      signal: new AbortController().signal,
      hooks: { requestConfirmation: confirm, onToolEvent: () => undefined }
    })
    expect(ran).toBe(false)
    expect(result.denied).toBe(true)
  })
})

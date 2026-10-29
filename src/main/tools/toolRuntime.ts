import { randomUUID } from 'node:crypto'
import type { ConfirmationRequest, Settings, ToolExecutionRecord } from '@shared/types'
import { AppError, normalizeError } from '../security/errors'
import { redactAndTruncate } from '../security/redaction'
import type { TaskService } from '../tasks/taskService'
import type { ToolContext, ToolDefinition } from './registry'
import type { Logger } from '../services/logger'

export interface ToolRuntimeHooks {
  requestConfirmation: (request: ConfirmationRequest) => Promise<boolean>
  onToolEvent: (payload: {
    toolName: string
    title: string
    status: ToolExecutionRecord['status']
    arguments?: Record<string, unknown>
    result?: string
    error?: string
  }) => void
}

export interface ToolInvocation {
  toolName: string
  callId: string
  args: Record<string, unknown>
  taskId: string
  signal: AbortSignal
  preferredWorkspaceId?: string | null
  hooks: ToolRuntimeHooks
}

export interface ToolInvocationResult {
  ok: boolean
  denied: boolean
  text: string
  display?: string
}

function permissionMissing(tool: ToolDefinition, settings: Settings): string[] {
  return [tool.permission, ...(tool.additionalPermissions ?? [])]
    .filter((key): key is NonNullable<typeof key> => Boolean(key))
    .filter((key) => !settings.permissions[key])
}

export class ToolRuntime {
  constructor(
    private readonly getTool: (id: string) => ToolDefinition | undefined,
    private readonly tasks: TaskService,
    private readonly settings: () => Settings,
    private readonly logger: Logger
  ) {}

  async invoke(invocation: ToolInvocation): Promise<ToolInvocationResult> {
    const tool = this.getTool(invocation.toolName)
    if (!tool) {
      this.logger.warn('tools', `Model requested an unknown tool: ${invocation.toolName}.`)
      return {
        ok: false,
        denied: true,
        text: `Tool "${invocation.toolName}" does not exist. Available tools are limited to the provided definitions.`
      }
    }

    const settings = this.settings()
    const missing = permissionMissing(tool, settings)
    if (missing.length) {
      const text = `Permission denied. The user has not enabled: ${missing.join(', ')}. Ask them to enable it in Settings → Permissions before retrying.`
      const run = this.tasks.addToolRun({
        taskId: invocation.taskId,
        toolName: tool.id,
        argsJson: JSON.stringify(invocation.args),
        status: 'denied',
        approval: 'not_required'
      })
      this.tasks.updateToolRun(run.id, {
        status: 'denied',
        error: text,
        finishedAt: new Date().toISOString()
      })
      invocation.hooks.onToolEvent({
        toolName: tool.id,
        title: tool.title,
        status: 'denied',
        arguments: invocation.args,
        error: text
      })
      return { ok: false, denied: true, text }
    }

    let parsed: Record<string, unknown>
    try {
      parsed = tool.parseArgs(invocation.args)
    } catch (error) {
      const normalized = normalizeError(error, 'The tool arguments were invalid.')
      const run = this.tasks.addToolRun({
        taskId: invocation.taskId,
        toolName: tool.id,
        argsJson: JSON.stringify(invocation.args),
        status: 'failed'
      })
      this.tasks.updateToolRun(run.id, {
        status: 'failed',
        error: normalized.userMessage,
        finishedAt: new Date().toISOString()
      })
      invocation.hooks.onToolEvent({
        toolName: tool.id,
        title: tool.title,
        status: 'failed',
        arguments: invocation.args,
        error: normalized.userMessage
      })
      return { ok: false, denied: false, text: `Invalid arguments: ${normalized.userMessage}` }
    }

    const context: ToolContext = {
      taskId: invocation.taskId,
      signal: invocation.signal,
      preferredWorkspaceId: invocation.preferredWorkspaceId
    }

    let approval: 'not_required' | 'pending' | 'approved' | 'denied' =
      tool.requiresConfirmation && settings.ai.confirmSensitiveActions ? 'pending' : 'not_required'
    let existingRunId: string | null = null

    if (tool.requiresConfirmation && settings.ai.confirmSensitiveActions) {
      let preview = ''
      try {
        preview = tool.preview ? await tool.preview(parsed, context) : ''
      } catch {
        preview = ''
      }
      const request: ConfirmationRequest = {
        id: randomUUID(),
        toolName: tool.id,
        title: tool.title,
        description: preview || tool.description,
        risk: tool.risk === 'low' ? 'medium' : tool.risk,
        argumentsPreview: redactAndTruncate(JSON.stringify(parsed, null, 2), 4000),
        expiresAt: new Date(Date.now() + 120_000).toISOString()
      }

      const pendingRun = this.tasks.addToolRun({
        taskId: invocation.taskId,
        toolName: tool.id,
        argsJson: JSON.stringify(parsed),
        approval: 'pending',
        status: 'awaiting_confirmation'
      })
      existingRunId = pendingRun.id
      this.tasks.setStatus(invocation.taskId, 'awaiting_confirmation')
      invocation.hooks.onToolEvent({
        toolName: tool.id,
        title: tool.title,
        status: 'awaiting_confirmation',
        arguments: parsed
      })
      let approved = false
      try {
        approved = await invocation.hooks.requestConfirmation(request)
      } catch (error) {
        this.tasks.updateToolRun(pendingRun.id, {
          status: 'cancelled',
          approval: 'denied',
          error: normalizeError(error).userMessage,
          finishedAt: new Date().toISOString()
        })
        if (invocation.signal.aborted) {
          throw new AppError('CANCELLED', 'The task was cancelled.')
        }
        throw error
      }
      if (!approved) {
        approval = 'denied'
        this.tasks.updateToolRun(pendingRun.id, {
          status: 'denied',
          approval: 'denied',
          error: 'The user declined this action.',
          finishedAt: new Date().toISOString()
        })
        this.tasks.setStatus(invocation.taskId, 'running')
        invocation.hooks.onToolEvent({
          toolName: tool.id,
          title: tool.title,
          status: 'denied',
          arguments: parsed,
          error: 'The user declined this action.'
        })
        return {
          ok: false,
          denied: true,
          text: 'The user declined this action. Do not retry it unless the user asks you to.'
        }
      }
      approval = 'approved'
      this.tasks.updateToolRun(pendingRun.id, { approval: 'approved', status: 'running' })
      this.tasks.setStatus(invocation.taskId, 'running')
    }

    const run = existingRunId
      ? { id: existingRunId }
      : this.tasks.addToolRun({
          taskId: invocation.taskId,
          toolName: tool.id,
          argsJson: JSON.stringify(parsed),
          approval,
          status: 'running'
        })
    this.tasks.updateToolRun(run.id, {
      startedAt: new Date().toISOString(),
      ...(existingRunId ? { status: 'running' } : {})
    })
    invocation.hooks.onToolEvent({
      toolName: tool.id,
      title: tool.title,
      status: 'running',
      arguments: parsed
    })

    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), tool.timeoutMs)
    const onParentAbort = (): void => timeoutController.abort()
    invocation.signal.addEventListener('abort', onParentAbort, { once: true })

    try {
      if (invocation.signal.aborted) throw new AppError('CANCELLED', 'The task was cancelled.')
      const outcome = await tool.run(parsed, { ...context, signal: timeoutController.signal })
      const safeText = redactAndTruncate(outcome.text, 30_000)
      this.tasks.updateToolRun(run.id, {
        status: 'completed',
        result: safeText,
        finishedAt: new Date().toISOString()
      })
      invocation.hooks.onToolEvent({
        toolName: tool.id,
        title: tool.title,
        status: 'completed',
        arguments: parsed,
        result: safeText
      })
      return { ok: true, denied: false, text: safeText, display: outcome.display }
    } catch (error) {
      if (invocation.signal.aborted) {
        this.tasks.updateToolRun(run.id, {
          status: 'cancelled',
          error: 'Cancelled.',
          finishedAt: new Date().toISOString()
        })
        throw new AppError('CANCELLED', 'The task was cancelled.')
      }
      if (timeoutController.signal.aborted) {
        const message = `Tool "${tool.id}" timed out after ${Math.round(tool.timeoutMs / 1000)} seconds.`
        this.tasks.updateToolRun(run.id, {
          status: 'failed',
          error: message,
          finishedAt: new Date().toISOString()
        })
        invocation.hooks.onToolEvent({
          toolName: tool.id,
          title: tool.title,
          status: 'failed',
          arguments: parsed,
          error: message
        })
        return { ok: false, denied: false, text: message }
      }
      const normalized = normalizeError(error, `Tool "${tool.id}" failed.`)
      this.tasks.updateToolRun(run.id, {
        status: 'failed',
        error: normalized.userMessage,
        finishedAt: new Date().toISOString()
      })
      invocation.hooks.onToolEvent({
        toolName: tool.id,
        title: tool.title,
        status: 'failed',
        arguments: parsed,
        error: normalized.userMessage
      })
      this.logger.warn('tools', `${tool.id} failed: ${normalized.userMessage}`)
      return {
        ok: false,
        denied: false,
        text: `Tool failed: ${normalized.userMessage}`
      }
    } finally {
      clearTimeout(timeout)
      invocation.signal.removeEventListener('abort', onParentAbort)
    }
  }
}

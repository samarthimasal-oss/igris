import type { ProviderKind, ToolCall } from '@shared/types'
import { AppError } from '../../security/errors'
import { normalizeBaseUrl, assertOk, httpRequest } from '../http'
import { parseSse, readErrorBody, tryParseJson } from '../sse'
import type {
  ModelRequest,
  ProviderAdapter,
  ProviderRuntimeConfig,
  ProviderStreamEvent,
  ProviderTestOutcome
} from '../types'

interface OpenAiToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAiModelEntry {
  id?: string
  name?: string
  cost?: {
    text?: {
      input?: { price?: number }
      output?: { price?: number }
    }
  }
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>
      tool_calls?: OpenAiToolCallDelta[]
    }
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string; type?: string }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : ''
      )
      .join('')
  }
  return ''
}

function mapMessages(request: ModelRequest): unknown[] {
  const messages: unknown[] = [{ role: 'system', content: request.system }]
  for (const message of request.messages) {
    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content || '(no output)'
      })
      continue
    }
    if (message.role === 'assistant') {
      const wire: Record<string, unknown> = {
        role: 'assistant',
        content: message.content || null
      }
      if (message.toolCalls?.length) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {})
          }
        }))
      }
      messages.push(wire)
      continue
    }
    messages.push({ role: 'user', content: message.content })
  }
  return messages
}

/**
 * OpenCode exposes its model catalogue at the gateway root, not under the
 * OpenAI-compatible path used for chat completions. Derive the real endpoint
 * for both pay-as-you-go and Go base URLs.
 */
export function openCodeModelsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl)
  const match = /^(.*)\/openai\/v1$/.exec(base)
  return match ? `${match[1]}/v1/models` : `${base}/models`
}

/** Free OpenCode models are restricted to OpenCode itself and fail from other clients. */
export function isFreeOpenCodeModel(entry: OpenAiModelEntry): boolean {
  const input = entry.cost?.text?.input?.price
  const output = entry.cost?.text?.output?.price
  return input === 0 && output === 0
}

export class OpenAiAdapter implements ProviderAdapter {
  readonly kind: ProviderKind
  readonly supportsModelList = true
  private readonly compatible: boolean

  constructor(kind: 'openai' | 'opencode' | 'openai-compatible' = 'openai') {
    this.kind = kind
    this.compatible = kind !== 'openai'
  }

  private headers(config: ProviderRuntimeConfig, sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
    if (this.kind === 'opencode' && sessionId) {
      headers['x-opencode-session'] = `ses_${sessionId}`
    }
    return headers
  }

  private body(request: ModelRequest, config: ProviderRuntimeConfig, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: mapMessages(request),
      temperature: request.temperature,
      stream
    }
    if (stream && !this.compatible) {
      body.stream_options = { include_usage: true }
    }
    if (config.supportsTools && request.tools.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }))
      body.tool_choice = 'auto'
    }
    return body
  }

  async listModels(config: ProviderRuntimeConfig): Promise<string[]> {
    const endpoint =
      this.kind === 'opencode'
        ? openCodeModelsUrl(config.baseUrl)
        : `${normalizeBaseUrl(config.baseUrl)}/models`
    const response = await httpRequest(endpoint, {
      method: 'GET',
      headers: this.headers(config),
      signal: AbortSignal.timeout(20000)
    })
    await assertOk(response)
    const data = (await response.json()) as {
      data?: OpenAiModelEntry[]
      models?: OpenAiModelEntry[]
    }
    const models = (data.data ?? data.models ?? [])
      .filter((model) => this.kind !== 'opencode' || !isFreeOpenCodeModel(model))
      .map((model) => model.id ?? model.name ?? '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    return models
  }

  async test(config: ProviderRuntimeConfig, model?: string): Promise<ProviderTestOutcome> {
    const started = Date.now()
    let models: string[] | undefined
    try {
      models = await this.listModels(config)
    } catch {
      models = undefined
    }
    if (!model) {
      if (!models) throw new AppError('CONFIG', 'The endpoint did not expose a model list. Enter a model and test again.')
      return {
        ok: true,
        message: `Connected. ${models.length} models reported by the endpoint.`,
        latencyMs: Date.now() - started,
        models
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)
    try {
      const response = await httpRequest(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: this.headers(config),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Connection check. Reply with exactly: OK' },
            { role: 'user', content: 'Reply with OK.' }
          ],
          max_tokens: 8,
          temperature: 0,
          stream: false
        }),
        signal: controller.signal
      })
      await assertOk(response)
      const data = (await response.json()) as OpenAiChunk
      if (data.error?.message) {
        throw new AppError('PROVIDER', data.error.message)
      }
      const reply = data.choices?.[0]?.message?.content
      const text = typeof reply === 'string' ? reply : ''
      return {
        ok: true,
        message: `Connected to ${model}.${text ? ` Response: ${text.slice(0, 40)}` : ''}`,
        latencyMs: Date.now() - started,
        models
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async *stream(
    request: ModelRequest,
    config: ProviderRuntimeConfig
  ): AsyncGenerator<ProviderStreamEvent> {
    const response = await httpRequest(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: this.headers(config, request.sessionId),
      body: JSON.stringify(this.body(request, config, true)),
      signal: request.signal
    })
    await assertOk(response)

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      // Some compatible endpoints ignore `stream`. Accept a normal JSON reply.
      const raw = await response.text()
      const parsed = tryParseJson<OpenAiChunk>(raw)
      if (!parsed) {
        throw new AppError('PROVIDER', 'The endpoint returned an unreadable response.', {
          internal: raw.slice(0, 500)
        })
      }
      const choice = parsed.choices?.[0]
      const text = choice?.message?.content
      const combined = typeof text === 'string' ? text : ''
      if (combined) yield { type: 'text', text: combined }
      for (const call of choice?.message?.tool_calls ?? []) {
        yield {
          type: 'tool_call',
          call: {
            id: call.id || `call_${Math.random().toString(36).slice(2)}`,
            name: call.function?.name || 'unknown',
            arguments: tryParseJson<Record<string, unknown>>(call.function?.arguments ?? '{}') ?? {}
          }
        }
      }
      if (parsed.usage) {
        yield {
          type: 'usage',
          inputTokens: parsed.usage.prompt_tokens,
          outputTokens: parsed.usage.completion_tokens,
          totalTokens: parsed.usage.total_tokens
        }
      }
      yield { type: 'done', finishReason: choice?.finish_reason ?? 'stop' }
      return
    }

    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    let finishReason = 'stop'

    for await (const data of parseSse(response)) {
      if (data.trim() === '[DONE]') break
      const chunk = tryParseJson<OpenAiChunk>(data)
      if (!chunk) continue
      if (chunk.error?.message) {
        throw new AppError('PROVIDER', chunk.error.message)
      }
      const choice = chunk.choices?.[0]
      if (choice?.delta?.content) {
        const text = contentToText(choice.delta.content)
        if (text) yield { type: 'text', text }
      }
      for (const callDelta of choice?.delta?.tool_calls ?? []) {
        const index = callDelta.index ?? 0
        const existing = toolCalls.get(index) ?? { id: '', name: '', args: '' }
        if (callDelta.id) existing.id = callDelta.id
        if (callDelta.function?.name) existing.name += callDelta.function.name
        if (callDelta.function?.arguments) existing.args += callDelta.function.arguments
        toolCalls.set(index, existing)
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens
        }
      }
    }

    for (const [index, call] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
      if (!call.name) continue
      const parsedArgs = tryParseJson<Record<string, unknown>>(call.args || '{}')
      if (parsedArgs === null) {
        throw new AppError(
          'PROVIDER',
          `The model returned invalid JSON arguments for tool "${call.name}".`
        )
      }
      const toolCall: ToolCall = {
        id: call.id || `call_${index}_${Date.now()}`,
        name: call.name,
        arguments: parsedArgs
      }
      yield { type: 'tool_call', call: toolCall }
    }
    yield { type: 'done', finishReason }
  }
}

export async function readProviderError(response: Response): Promise<string> {
  try {
    const text = await readErrorBody(response)
    const parsed = tryParseJson<{ error?: { message?: string } }>(text)
    return parsed?.error?.message || text
  } catch {
    return 'Unknown provider error'
  }
}

import type { ToolCall } from '@shared/types'
import { AppError } from '../../security/errors'
import { assertOk, httpRequest, normalizeBaseUrl } from '../http'
import { parseSse, tryParseJson } from '../sse'
import type {
  ModelMessage,
  ModelRequest,
  ProviderAdapter,
  ProviderRuntimeConfig,
  ProviderStreamEvent,
  ProviderTestOutcome
} from '../types'

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

interface AnthropicChunk {
  type?: string
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number }
    content?: AnthropicBlock[]
    stop_reason?: string
  }
  index?: number
  content_block?: {
    type?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
    text?: string
  }
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string
  }
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string; type?: string }
}

function mapMessages(messages: ModelMessage[]): AnthropicMessage[] {
  const mapped: AnthropicMessage[] = []
  for (const message of messages) {
    let role: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user'
    const blocks: AnthropicBlock[] = []
    if (message.role === 'tool') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? 'unknown',
        content: message.content || '(no output)'
      })
    } else if (message.role === 'assistant') {
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments ?? {}
        })
      }
    } else if (message.content) {
      blocks.push({ type: 'text', text: message.content })
    }
    if (!blocks.length) continue
    const previous = mapped[mapped.length - 1]
    if (previous && previous.role === role) {
      previous.content.push(...blocks)
    } else {
      mapped.push({ role, content: blocks })
    }
  }
  return mapped
}

function headers(config: ProviderRuntimeConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(config.apiKey ? { 'x-api-key': config.apiKey } : {})
  }
}

function mapTools(request: ModelRequest): unknown[] {
  return request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }))
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = 'anthropic' as const
  readonly supportsModelList = true

  async listModels(config: ProviderRuntimeConfig): Promise<string[]> {
    const response = await httpRequest(`${normalizeBaseUrl(config.baseUrl)}/models?limit=1000`, {
      method: 'GET',
      headers: headers(config),
      signal: AbortSignal.timeout(20000)
    })
    await assertOk(response)
    const data = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> }
    return (data.data ?? [])
      .map((model) => model.id ?? '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
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
      if (!models) {
        throw new AppError('CONFIG', 'The endpoint did not list models. Enter a model and test again.')
      }
      return {
        ok: true,
        message: `Connected. ${models.length} Claude models reported.`,
        latencyMs: Date.now() - started,
        models
      }
    }
    if (models && !models.includes(model)) {
      throw new AppError(
        'PROVIDER',
        `The credential works, but "${model}" is not in the model list reported by Anthropic.`,
        { internal: `Models: ${models.slice(0, 20).join(', ')}` }
      )
    }

    const response = await httpRequest(`${normalizeBaseUrl(config.baseUrl)}/messages`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
      }),
      signal: AbortSignal.timeout(25000)
    })
    await assertOk(response)
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> }
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
    return {
      ok: true,
      message: `Connected to ${model}.${text ? ` Response: ${text.slice(0, 40)}` : ''}`,
      latencyMs: Date.now() - started,
      models
    }
  }

  async *stream(
    request: ModelRequest,
    config: ProviderRuntimeConfig
  ): AsyncGenerator<ProviderStreamEvent> {
    const response = await httpRequest(`${normalizeBaseUrl(config.baseUrl)}/messages`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        model: request.model,
        system: request.system,
        messages: mapMessages(request.messages),
        max_tokens: request.maxOutputTokens,
        temperature: Math.min(1, Math.max(0, request.temperature)),
        ...(config.supportsTools && request.tools.length
          ? { tools: mapTools(request), tool_choice: { type: 'auto' } }
          : {}),
        stream: true
      }),
      signal: request.signal
    })
    await assertOk(response)

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      const raw = await response.text()
      const parsed = tryParseJson<AnthropicChunk>(raw)
      if (!parsed) {
        throw new AppError('PROVIDER', 'Anthropic returned an unreadable response.', {
          internal: raw.slice(0, 500)
        })
      }
      for (const block of parsed.message?.content ?? []) {
        if (block.type === 'text') yield { type: 'text', text: block.text }
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_call',
            call: { id: block.id, name: block.name, arguments: block.input ?? {} }
          }
        }
      }
      yield { type: 'done', finishReason: parsed.message?.stop_reason ?? 'stop' }
      return
    }

    const toolState = new Map<number, { id: string; name: string; json: string; input: Record<string, unknown> }>()
    let finishReason = 'stop'

    for await (const data of parseSse(response)) {
      const chunk = tryParseJson<AnthropicChunk>(data)
      if (!chunk) continue
      if (chunk.type === 'error') {
        throw new AppError('PROVIDER', chunk.error?.message ?? 'Anthropic reported a streaming error.')
      }
      if (chunk.type === 'message_start' && chunk.message?.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.message.usage.input_tokens,
          outputTokens: chunk.message.usage.output_tokens
        }
      }
      if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
        toolState.set(chunk.index ?? 0, {
          id: chunk.content_block.id ?? `tool_${chunk.index ?? 0}`,
          name: chunk.content_block.name ?? 'unknown',
          json: '',
          input: chunk.content_block.input ?? {}
        })
      }
      if (chunk.type === 'content_block_delta') {
        if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
          yield { type: 'text', text: chunk.delta.text }
        }
        if (chunk.delta?.type === 'input_json_delta') {
          const state = toolState.get(chunk.index ?? 0)
          if (state) state.json += chunk.delta.partial_json ?? ''
        }
      }
      if (chunk.type === 'message_delta') {
        if (chunk.delta?.stop_reason) finishReason = chunk.delta.stop_reason
        if (chunk.usage) {
          yield { type: 'usage', outputTokens: chunk.usage.output_tokens }
        }
      }
    }

    for (const state of [...toolState.values()]) {
      let args = state.input
      if (state.json.trim()) {
        const parsed = tryParseJson<Record<string, unknown>>(state.json)
        if (!parsed) {
          throw new AppError('PROVIDER', `Anthropic returned malformed arguments for tool "${state.name}".`)
        }
        args = parsed
      }
      const call: ToolCall = { id: state.id, name: state.name, arguments: args }
      yield { type: 'tool_call', call }
    }

    yield { type: 'done', finishReason }
  }
}

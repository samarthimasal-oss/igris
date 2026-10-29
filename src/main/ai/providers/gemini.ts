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

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message?: string }
}

function cleanModelName(model: string): string {
  return model.replace(/^models\//, '')
}

function mapContents(messages: ModelMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = []
  const push = (role: 'user' | 'model', parts: GeminiPart[]): void => {
    if (!parts.length) return
    const previous = contents[contents.length - 1]
    if (previous && previous.role === role) previous.parts.push(...parts)
    else contents.push({ role, parts })
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      push('user', [
        {
          functionResponse: {
            name: message.toolName ?? 'tool',
            response: { result: message.content || '(no output)' }
          }
        }
      ])
      continue
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } })
      }
      push('model', parts)
      continue
    }
    if (message.content) push('user', [{ text: message.content }])
  }
  return contents
}

function headers(): Record<string, string> {
  return { 'content-type': 'application/json' }
}

function keyParam(config: ProviderRuntimeConfig): string {
  if (!config.apiKey) return ''
  return `key=${encodeURIComponent(config.apiKey)}`
}

function extractParts(chunk: GeminiChunk): {
  text: string
  calls: Array<{ name: string; args: Record<string, unknown> }>
} {
  let text = ''
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  for (const candidate of chunk.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if ('text' in part && typeof part.text === 'string') text += part.text
      if ('functionCall' in part && part.functionCall?.name) {
        calls.push({
          name: part.functionCall.name,
          args: part.functionCall.args ?? {}
        })
      }
    }
  }
  return { text, calls }
}

export class GeminiAdapter implements ProviderAdapter {
  readonly kind = 'gemini' as const
  readonly supportsModelList = true

  async listModels(config: ProviderRuntimeConfig): Promise<string[]> {
    const url = `${normalizeBaseUrl(config.baseUrl)}/models?pageSize=1000&${keyParam(config)}`
    const response = await httpRequest(url, {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(20000)
    })
    await assertOk(response)
    const data = (await response.json()) as {
      models?: Array<{
        name?: string
        supportedGenerationMethods?: string[]
      }>
    }
    return (data.models ?? [])
      .filter((model) => (model.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((model) => cleanModelName(model.name ?? ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  }

  async test(config: ProviderRuntimeConfig, model?: string): Promise<ProviderTestOutcome> {
    const started = Date.now()
    const models = await this.listModels(config)
    if (model && !models.includes(cleanModelName(model))) {
      throw new AppError(
        'PROVIDER',
        `The API key works, but "${model}" is not a Gemini text-generation model available to this account.`,
        { internal: `Models: ${models.slice(0, 20).join(', ')}` }
      )
    }
    return {
      ok: true,
      message: model
        ? `Connected to ${cleanModelName(model)}.`
        : `Connected. ${models.length} Gemini text models reported.`,
      latencyMs: Date.now() - started,
      models
    }
  }

  async *stream(
    request: ModelRequest,
    config: ProviderRuntimeConfig
  ): AsyncGenerator<ProviderStreamEvent> {
    const model = encodeURIComponent(cleanModelName(request.model))
    const url = `${normalizeBaseUrl(config.baseUrl)}/models/${model}:streamGenerateContent?alt=sse&${keyParam(config)}`
    const body: Record<string, unknown> = {
      contents: mapContents(request.messages),
      systemInstruction: { parts: [{ text: request.system }] },
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens
      }
    }
    if (config.supportsTools && request.tools.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }))
        }
      ]
    }

    const response = await httpRequest(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: request.signal
    })
    await assertOk(response)

    const contentType = response.headers.get('content-type') ?? ''
    let finishReason = 'stop'
    let callIndex = 0

    const handleChunk = function* (chunk: GeminiChunk): Generator<ProviderStreamEvent> {
      if (chunk.error?.message) {
        throw new AppError('PROVIDER', chunk.error.message)
      }
      const { text, calls } = extractParts(chunk)
      if (text) yield { type: 'text', text }
      for (const call of calls) {
        callIndex += 1
        const toolCall: ToolCall = {
          id: `gemini_call_${Date.now()}_${callIndex}`,
          name: call.name,
          arguments: call.args
        }
        yield { type: 'tool_call', call: toolCall }
      }
      if (chunk.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: chunk.usageMetadata.promptTokenCount,
          outputTokens: chunk.usageMetadata.candidatesTokenCount,
          totalTokens: chunk.usageMetadata.totalTokenCount
        }
      }
      for (const candidate of chunk.candidates ?? []) {
        if (candidate.finishReason) finishReason = candidate.finishReason
      }
    }

    if (!contentType.includes('text/event-stream')) {
      const raw = await response.text()
      const parsed = tryParseJson<GeminiChunk | GeminiChunk[]>(raw)
      if (!parsed) {
        throw new AppError('PROVIDER', 'Gemini returned an unreadable response.', {
          internal: raw.slice(0, 500)
        })
      }
      for (const chunk of Array.isArray(parsed) ? parsed : [parsed]) {
        yield* handleChunk(chunk)
      }
      yield { type: 'done', finishReason }
      return
    }

    for await (const data of parseSse(response)) {
      const chunk = tryParseJson<GeminiChunk>(data)
      if (!chunk) continue
      yield* handleChunk(chunk)
    }
    yield { type: 'done', finishReason }
  }
}

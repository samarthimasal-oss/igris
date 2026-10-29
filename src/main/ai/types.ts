import type { ProviderKind, ToolCall } from '@shared/types'

export interface ModelTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ModelMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
}

export interface ProviderRuntimeConfig {
  kind: ProviderKind
  baseUrl: string
  apiKey: string | null
  supportsTools: boolean
}

export interface ModelRequest {
  model: string
  system: string
  messages: ModelMessage[]
  tools: ModelTool[]
  temperature: number
  maxOutputTokens: number
  signal: AbortSignal
  streaming: boolean
}

export type ProviderStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: 'done'; finishReason: string }

export interface ProviderTestOutcome {
  ok: boolean
  message: string
  latencyMs?: number
  models?: string[]
}

export interface ProviderAdapter {
  kind: ProviderKind
  supportsModelList: boolean
  stream(
    request: ModelRequest,
    config: ProviderRuntimeConfig
  ): AsyncGenerator<ProviderStreamEvent>
  listModels(config: ProviderRuntimeConfig): Promise<string[]>
  test(config: ProviderRuntimeConfig, model?: string): Promise<ProviderTestOutcome>
}

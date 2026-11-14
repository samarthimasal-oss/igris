import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiAdapter } from '../../src/main/ai/providers/gemini'
import type { ModelRequest, ProviderRuntimeConfig } from '../../src/main/ai/types'

const config: ProviderRuntimeConfig = {
  kind: 'gemini',
  baseUrl: 'https://example.test/v1beta',
  apiKey: 'test-key',
  supportsTools: true
}

function sseResponse(parts: unknown[]): Response {
  const chunk = {
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }]
  }
  return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

function request(messages: ModelRequest['messages']): ModelRequest {
  return {
    model: 'gemini-3.6-flash',
    system: 'test',
    messages,
    tools: [
      {
        name: 'get_weather',
        description: 'Get the weather.',
        parameters: { type: 'object', properties: { city: { type: 'string' } } }
      }
    ],
    temperature: 0,
    maxOutputTokens: 128,
    signal: new AbortController().signal,
    streaming: true
  }
}

function mockFetch(responses: Response[]): { mock: ReturnType<typeof vi.fn>; bodies: string[] } {
  const bodies: string[] = []
  let index = 0
  const mock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''))
    const response = responses[index] ?? responses[responses.length - 1]
    index += 1
    return response!
  })
  return { mock, bodies }
}

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = []
  for await (const event of generator) events.push(event)
  return events
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gemini thought signatures', () => {
  it('captures the thoughtSignature attached to a function call', async () => {
    const { mock } = mockFetch([
      sseResponse([
        {
          functionCall: { name: 'get_weather', args: { city: 'Paris' } },
          thoughtSignature: 'sig-123'
        }
      ])
    ])
    vi.stubGlobal('fetch', mock)

    const events = (await collect(
      new GeminiAdapter().stream(request([{ role: 'user', content: 'Weather in Paris?' }]), config)
    )) as Array<{ type: string; call?: { thoughtSignature?: string } }>

    const callEvent = events.find((event) => event.type === 'tool_call')
    expect(callEvent?.call?.thoughtSignature).toBe('sig-123')
  })

  it('echoes the signature when the tool call is replayed to Gemini', async () => {
    const responses = [
      sseResponse([
        {
          functionCall: { name: 'get_weather', args: { city: 'Paris' } },
          thoughtSignature: 'sig-123'
        }
      ]),
      sseResponse([{ text: 'It is 22C.' }])
    ]
    const { mock, bodies } = mockFetch(responses)
    vi.stubGlobal('fetch', mock)
    const adapter = new GeminiAdapter()

    const events = (await collect(
      adapter.stream(request([{ role: 'user', content: 'Weather in Paris?' }]), config)
    )) as Array<{
      type: string
      call: {
        id: string
        name: string
        arguments: Record<string, unknown>
        thoughtSignature?: string
      }
    }>
    const call = events.find((event) => event.type === 'tool_call')!.call

    await collect(
      adapter.stream(
        request([
          { role: 'user', content: 'Weather in Paris?' },
          { role: 'assistant', content: '', toolCalls: [call] },
          {
            role: 'tool',
            content: '22C and sunny',
            toolCallId: call.id,
            toolName: call.name
          }
        ]),
        config
      )
    )

    const body = JSON.parse(bodies[1]!) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>
    }
    const modelTurn = body.contents.find((content) => content.role === 'model')
    expect(modelTurn?.parts[0]).toMatchObject({
      functionCall: { name: 'get_weather', args: { city: 'Paris' } },
      thoughtSignature: 'sig-123'
    })
  })

  it('omits the signature field for calls that never had one', async () => {
    const { mock, bodies } = mockFetch([sseResponse([{ text: 'ok' }])])
    vi.stubGlobal('fetch', mock)

    await collect(
      new GeminiAdapter().stream(
        request([
          { role: 'user', content: 'Weather?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'Paris' } }]
          },
          { role: 'tool', content: '22C', toolCallId: 'call_1', toolName: 'get_weather' }
        ]),
        config
      )
    )

    const body = JSON.parse(bodies[0]!) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>
    }
    const modelTurn = body.contents.find((content) => content.role === 'model')
    expect(modelTurn?.parts[0]).not.toHaveProperty('thoughtSignature')
  })
})

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  isFreeOpenCodeModel,
  openCodeModelsUrl,
  OpenAiAdapter
} from '../../src/main/ai/providers/openai'
import { PROVIDER_CATALOG, PROVIDER_ORDER } from '../../src/shared/defaults'

describe('OpenCode Console provider', () => {
  it('derives the catalogue URL for pay-as-you-go and Go base URLs', () => {
    expect(openCodeModelsUrl('https://opencode.ai/inference/openai/v1')).toBe(
      'https://opencode.ai/inference/v1/models'
    )
    expect(openCodeModelsUrl('https://opencode.ai/inference/go/openai/v1/')).toBe(
      'https://opencode.ai/inference/go/v1/models'
    )
    expect(openCodeModelsUrl('https://example.test/v1')).toBe('https://example.test/v1/models')
  })

  it('detects free models that other clients cannot call', () => {
    expect(
      isFreeOpenCodeModel({
        id: 'glm-5.3-flash-free',
        cost: { text: { input: { price: 0 }, output: { price: 0 } } }
      })
    ).toBe(true)
    expect(
      isFreeOpenCodeModel({
        id: 'claude-sonnet-5-5',
        cost: { text: { input: { price: 2 }, output: { price: 10 } } }
      })
    ).toBe(false)
    expect(isFreeOpenCodeModel({ id: 'unknown' })).toBe(false)
  })

  it('is registered as a first-class provider with the documented endpoint', () => {
    expect(PROVIDER_ORDER).toContain('opencode')
    expect(PROVIDER_CATALOG.opencode).toMatchObject({
      label: 'OpenCode Console',
      defaultBaseUrl: 'https://opencode.ai/inference/openai/v1',
      requiresKey: true,
      modelListSupport: true,
      toolSupport: 'native'
    })
  })

  it('streams through the gateway with the stable session header', async () => {
    let path = ''
    let session = ''
    const server = createServer((request, response) => {
      path = request.url ?? ''
      session = String(request.headers['x-opencode-session'] ?? '')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const events = []
      for await (const event of new OpenAiAdapter('opencode').stream(
        {
          model: 'glm-5.3',
          sessionId: 'conversation-1',
          system: 'test',
          messages: [{ role: 'user', content: 'hello' }],
          tools: [],
          temperature: 0,
          maxOutputTokens: 8,
          streaming: true,
          signal: AbortSignal.timeout(5_000)
        },
        {
          kind: 'opencode',
          baseUrl: `http://127.0.0.1:${port}/openai/v1`,
          apiKey: 'test-key',
          supportsTools: true
        }
      )) {
        events.push(event)
      }

      expect(path).toBe('/openai/v1/chat/completions')
      expect(session).toBe('ses_conversation-1')
      expect(events).toContainEqual({ type: 'text', text: 'OK' })
      expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

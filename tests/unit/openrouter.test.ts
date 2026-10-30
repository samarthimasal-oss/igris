import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  isFreeOpenRouterModel,
  isFreeOpenRouterModelId,
  OpenAiAdapter
} from '../../src/main/ai/providers/openai'
import { ProviderService } from '../../src/main/services/providerService'
import type { ProviderRepository } from '../../src/main/storage/repositories'
import type { CredentialStore } from '../../src/main/security/credentials'
import type { Logger } from '../../src/main/services/logger'
import { PROVIDER_CATALOG, PROVIDER_ORDER } from '../../src/shared/defaults'

describe('OpenRouter free provider', () => {
  it('is registered as a free-only first-class provider', () => {
    expect(PROVIDER_ORDER).toContain('openrouter')
    expect(PROVIDER_CATALOG.openrouter).toMatchObject({
      label: 'OpenRouter Free',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      requiresKey: true,
      allowsCustomBaseUrl: false,
      modelListSupport: true,
      toolSupport: 'configurable'
    })
  })

  it('accepts only model IDs marked as free', () => {
    expect(isFreeOpenRouterModel({ id: 'google/gemma-4-31b-it:free' })).toBe(true)
    expect(isFreeOpenRouterModelId('google/gemma-4-31b-it:free')).toBe(true)
    expect(isFreeOpenRouterModelId('  google/gemma-4-31b-it:free  ')).toBe(true)
    expect(isFreeOpenRouterModel({ id: 'openai/gpt-6.1' })).toBe(false)
    expect(isFreeOpenRouterModelId('openai/gpt-6.1')).toBe(false)
    expect(isFreeOpenRouterModelId('')).toBe(false)

    const repo = {
      get: () => null,
      count: () => 0,
      save: () => undefined
    } as unknown as ProviderRepository
    const credentials = {
      encrypt: (value: string) => new TextEncoder().encode(value),
      decrypt: () => null
    } as unknown as CredentialStore
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    } as unknown as Logger
    const service = new ProviderService(repo, credentials, logger)

    expect(() =>
      service.save({
        name: 'Free only',
        kind: 'openrouter',
        defaultModel: 'openai/gpt-6.1',
        apiKey: 'test-key'
      })
    ).toThrow('restricted to free models')

    expect(
      service.save({
        name: 'Free only',
        kind: 'openrouter',
        defaultModel: 'google/gemma-4-31b-it:free',
        apiKey: 'test-key'
      }).defaultModel
    ).toBe('google/gemma-4-31b-it:free')
  })

  it('lists only free models from the OpenRouter catalogue', async () => {
    let path = ''
    let authorization = ''
    let title = ''
    const server = createServer((request, response) => {
      path = request.url ?? ''
      authorization = String(request.headers.authorization ?? '')
      title = String(request.headers['x-title'] ?? '')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          data: [
            { id: 'google/gemma-4-31b-it:free' },
            { id: 'openai/gpt-6.1' },
            { id: 'nvidia/nemotron-3.5-lightning:free' },
            { id: 'anthropic/claude-sonnet-5-5' }
          ]
        })
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const models = await new OpenAiAdapter('openrouter').listModels({
        kind: 'openrouter',
        baseUrl: `http://127.0.0.1:${port}/api/v1`,
        apiKey: 'test-key',
        supportsTools: true
      })

      expect(models).toEqual([
        'google/gemma-4-31b-it:free',
        'nvidia/nemotron-3.5-lightning:free'
      ])
      expect(path).toBe('/api/v1/models')
      expect(authorization).toBe('Bearer test-key')
      expect(title).toBe('IGRIS')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('streams a free model through chat completions', async () => {
    let path = ''
    let body = ''
    const server = createServer((request, response) => {
      path = request.url ?? ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(
          'data: {"choices":[{"delta":{"content":"Free"},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]\n\n'
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const events = []
      for await (const event of new OpenAiAdapter('openrouter').stream(
        {
          model: 'google/gemma-4-31b-it:free',
          system: 'test',
          messages: [{ role: 'user', content: 'hello' }],
          tools: [],
          temperature: 0,
          maxOutputTokens: 8,
          streaming: true,
          signal: AbortSignal.timeout(5_000)
        },
        {
          kind: 'openrouter',
          baseUrl: `http://127.0.0.1:${port}/api/v1`,
          apiKey: 'test-key',
          supportsTools: false
        }
      )) {
        events.push(event)
      }

      expect(path).toBe('/api/v1/chat/completions')
      expect(JSON.parse(body).model).toBe('google/gemma-4-31b-it:free')
      expect(events).toContainEqual({ type: 'text', text: 'Free' })
      expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

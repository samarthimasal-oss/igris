import { describe, expect, it } from 'vitest'
import { sanitizeGeminiSchema } from '../../src/main/ai/providers/gemini'
import { createToolRegistry } from '../../src/main/tools/registry'

const FORBIDDEN = ['exclusiveMinimum', 'exclusiveMaximum', 'additionalProperties', '$schema']

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, key))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([entryKey, entry]) => entryKey === key || containsKey(entry, key)
    )
  }
  return false
}

describe('sanitizeGeminiSchema', () => {
  it('converts numeric exclusive bounds into inclusive ones', () => {
    const schema = {
      type: 'object',
      properties: {
        handle: { type: 'integer', exclusiveMinimum: 0, maximum: 100 },
        ratio: { type: 'number', exclusiveMaximum: 1, minimum: 0 }
      }
    }
    expect(sanitizeGeminiSchema(schema)).toEqual({
      type: 'object',
      properties: {
        handle: { type: 'integer', minimum: 0, maximum: 100 },
        ratio: { type: 'number', maximum: 1, minimum: 0 }
      }
    })
  })

  it('drops keywords Gemini does not accept and keeps the rest', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      default: {},
      properties: {
        keys: {
          anyOf: [
            { type: 'string', maxLength: 80 },
            { type: 'array', items: { type: 'string' }, minItems: 1 }
          ]
        }
      },
      required: ['keys']
    }
    const sanitized = sanitizeGeminiSchema(schema) as Record<string, unknown>
    expect(containsKey(sanitized, 'additionalProperties')).toBe(false)
    expect(containsKey(sanitized, '$schema')).toBe(false)
    expect(containsKey(sanitized, 'default')).toBe(false)
    expect(sanitized.required).toEqual(['keys'])
    expect(JSON.stringify(sanitized)).toContain('anyOf')
  })

  it('keeps every provider tool schema free of unknown keywords', () => {
    const registry = createToolRegistry({} as never)
    for (const tool of registry.providerTools()) {
      const sanitized = sanitizeGeminiSchema(tool.parameters)
      for (const key of FORBIDDEN) {
        expect(containsKey(sanitized, key), `${tool.name} still has ${key}`).toBe(false)
      }
    }
  })

  it('lowers the positive window handle to an inclusive minimum', () => {
    const registry = createToolRegistry({} as never)
    const desktop = registry.providerTools().find((tool) => tool.name === 'desktop')
    const parameters = sanitizeGeminiSchema(desktop?.parameters) as {
      properties: Record<string, Record<string, unknown>>
    }
    expect(parameters.properties.handle).toMatchObject({ type: 'integer', minimum: 0 })
    expect(parameters.properties.handle).not.toHaveProperty('exclusiveMinimum')
  })
})

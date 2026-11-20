import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { ChatEngine, pruneContextImages } from '../../src/main/ai/chatEngine'
import type { ModelMessage } from '../../src/main/ai/types'

function image(data: string) {
  return { mimeType: 'image/jpeg', data }
}

describe('pruneContextImages', () => {
  it('keeps only the newest screenshots', () => {
    const messages: ModelMessage[] = [
      { role: 'tool', content: 'one', images: [image('a')] },
      { role: 'tool', content: 'two', images: [image('b')] },
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', content: 'three', images: [image('c')] }
    ]
    pruneContextImages(messages)
    expect(messages[0]?.images).toBeUndefined()
    expect(messages[1]?.images?.[0]?.data).toBe('b')
    expect(messages[3]?.images?.[0]?.data).toBe('c')
  })

  it('keeps the newest images when one result has several', () => {
    const messages: ModelMessage[] = [
      { role: 'tool', content: 'many', images: [image('a'), image('b'), image('c')] }
    ]
    pruneContextImages(messages)
    expect(messages[0]?.images?.map((entry) => entry.data)).toEqual(['b', 'c'])
  })

  it('leaves messages without images untouched', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
    pruneContextImages(messages)
    expect(messages).toEqual([{ role: 'user', content: 'hello' }])
  })
})

describe('control system prompt', () => {
  function prompt(): string {
    const engine = new ChatEngine({
      conversations: {},
      memories: { recent: () => [] },
      workspaces: { list: () => [] },
      tasks: {},
      providers: {},
      settings: { get: () => DEFAULT_SETTINGS },
      tools: {},
      toolRuntime: {},
      control: {},
      logger: {},
      emit: () => undefined
    } as never)
    const build = (
      engine as unknown as {
        buildSystemPrompt: (active: unknown, workspaceId?: string | null) => string
      }
    ).buildSystemPrompt.bind(engine)
    return build(
      {
        provider: {
          provider: { name: 'Test Provider' },
          model: 'test-model',
          runtime: { supportsTools: true }
        }
      },
      null
    )
  }

  it('describes the control loop and stop hotkey', () => {
    const text = prompt()
    expect(text).toContain('request_computer_control')
    expect(text).toContain('Ctrl+Alt+Shift+X')
    expect(text).toContain('one action')
    expect(text).toContain('password')
  })

  it('no longer claims IGRIS cannot click or type', () => {
    expect(prompt()).not.toContain('no keyboard/mouse control')
  })
})

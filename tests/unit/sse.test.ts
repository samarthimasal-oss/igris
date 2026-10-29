import { describe, expect, it } from 'vitest'
import { parseSse, readErrorBody, tryParseJson } from '../../src/main/ai/sse'

function streamResponse(chunks: Uint8Array[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

async function collect(response: Response): Promise<string[]> {
  const events: string[] = []
  for await (const event of parseSse(response)) events.push(event)
  return events
}

const encoder = new TextEncoder()

describe('parseSse', () => {
  it('extracts data payloads from SSE blocks', async () => {
    const response = streamResponse([
      encoder.encode('event: message\ndata: {"delta":"Hel"}\n\n'),
      encoder.encode('data: {"delta":"lo"}\n\n')
    ])
    expect(await collect(response)).toEqual(['{"delta":"Hel"}', '{"delta":"lo"}'])
  })

  it('handles CRLF delimiters split across chunks', async () => {
    const response = streamResponse([
      encoder.encode('data: first\r'),
      encoder.encode('\n\r'),
      encoder.encode('\ndata: second\r\n\r\n')
    ])
    expect(await collect(response)).toEqual(['first', 'second'])
  })

  it('joins multiline data fields and ignores comments', async () => {
    const response = streamResponse([
      encoder.encode(': keepalive\n'),
      encoder.encode('data: line one\ndata: line two\n\n')
    ])
    expect(await collect(response)).toEqual(['line one\nline two'])
  })

  it('preserves UTF-8 characters split across network chunks', async () => {
    const bytes = encoder.encode('data: hello 🌍\n\n')
    const split = 9
    const response = streamResponse([bytes.slice(0, split), bytes.slice(split)])
    expect(await collect(response)).toEqual(['hello 🌍'])
  })

  it('flushes a trailing block without a blank line', async () => {
    const response = streamResponse([encoder.encode('data: final')])
    expect(await collect(response)).toEqual(['final'])
  })

  it('skips blocks that contain no data field', async () => {
    const response = streamResponse([encoder.encode('event: ping\n\n')])
    expect(await collect(response)).toEqual([])
  })
})

describe('tryParseJson', () => {
  it('returns parsed objects and null for invalid input', () => {
    expect(tryParseJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true })
    expect(tryParseJson('not json')).toBeNull()
  })
})

describe('readErrorBody', () => {
  it('reads and caps an error response body', async () => {
    const long = 'x'.repeat(3000)
    const response = new Response(long, { status: 500 })
    const body = await readErrorBody(response)
    expect(body).toHaveLength(2000)
  })
})

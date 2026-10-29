/**
 * Incremental Server-Sent Events parser for streaming provider responses.
 * Handles CRLF, multi-line data fields, comments and a trailing block.
 */
export async function* parseSse(response: Response): AsyncGenerator<string> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flushBlock = (block: string): string | null => {
    const lines = block.split(/\r?\n/)
    const data: string[] = []
    for (const line of lines) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) return null
    return data.join('\n')
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary !== -1) {
        const delimiterLength = buffer.slice(boundary).startsWith('\r\n\r\n') ? 4 : 2
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + delimiterLength)
        const event = flushBlock(block)
        if (event !== null) yield event
        boundary = buffer.search(/\r?\n\r?\n/)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const event = flushBlock(buffer)
      if (event !== null) yield event
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The stream may already be closed.
    }
  }
}

export function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000)
  } catch {
    return response.statusText
  }
}

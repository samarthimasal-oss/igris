import { describe, expect, it } from 'vitest'
import { OperatorClient } from '../../src/main/control/operatorClient'
import type { OperatorLogger } from '../../src/main/control/operatorClient'

const quietLogger: OperatorLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

const FAKE_HOST = String.raw`
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const noReady = process.env.FAKE_OPERATOR_NO_READY === '1'
if (!noReady) send({ ready: true, version: 1 })
rl.on('line', (line) => {
  if (!line.trim()) return
  const request = JSON.parse(line)
  if (request.cmd === 'echo') {
    send({ id: request.id, ok: true, data: request.args })
    return
  }
  if (request.cmd === 'slow') {
    return
  }
  if (request.cmd === 'die') {
    send({ id: request.id, ok: true, data: 'bye' })
    setTimeout(() => process.exit(0), 20)
    return
  }
  send({ id: request.id, ok: false, error: 'unknown command: ' + request.cmd })
})
`

function makeClient(options: {
  noReady?: boolean
  maxRestarts?: number
  requestTimeoutMs?: number
  handshakeTimeoutMs?: number
} = {}) {
  if (options.noReady) process.env.FAKE_OPERATOR_NO_READY = '1'
  else delete process.env.FAKE_OPERATOR_NO_READY
  return new OperatorClient({
    logger: quietLogger,
    command: process.execPath,
    args: ['-e', FAKE_HOST],
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 2000,
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    maxRestarts: options.maxRestarts ?? 3
  })
}

describe('OperatorClient', () => {
  it('performs the startup handshake and round-trips a request', async () => {
    const client = makeClient()
    try {
      const state = await client.start()
      expect(state.version).toBe(1)
      expect(client.isReady()).toBe(true)
      const echoed = await client.request<Record<string, unknown>>('echo', { value: 42 })
      expect(echoed.value).toBe(42)
    } finally {
      await client.stop()
    }
  })

  it('surfaces host errors as AppError without killing the host', async () => {
    const client = makeClient()
    try {
      await client.start()
      await expect(client.request('nothing')).rejects.toThrow(/unknown command/)
      const echoed = await client.request<Record<string, unknown>>('echo', { alive: true })
      expect(echoed.alive).toBe(true)
    } finally {
      await client.stop()
    }
  })

  it('times out a stuck request and restarts the host', async () => {
    const client = makeClient({ requestTimeoutMs: 150 })
    try {
      await client.start()
      await expect(client.request('slow')).rejects.toThrow(/timed out/i)
      await client.waitForExit()
      const echoed = await client.request<Record<string, unknown>>('echo', { after: 'restart' })
      expect(echoed.after).toBe('restart')
    } finally {
      await client.stop()
    }
  })

  it('restarts after an unexpected host exit', async () => {
    const client = makeClient()
    try {
      await client.start()
      await expect(client.request('die')).resolves.toBe('bye')
      await client.waitForExit()
      const echoed = await client.request<Record<string, unknown>>('echo', { after: 'crash' })
      expect(echoed.after).toBe('crash')
    } finally {
      await client.stop()
    }
  })

  it('fails closed when the handshake never arrives', async () => {
    const client = makeClient({ noReady: true, handshakeTimeoutMs: 200 })
    await expect(client.start()).rejects.toThrow(/handshake|timed out/i)
    await client.stop()
  })
})

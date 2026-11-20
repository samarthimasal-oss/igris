import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { AppError } from '../security/errors'

export interface OperatorLogger {
  info(scope: string, message: string): void
  warn(scope: string, message: string): void
  error(scope: string, message: string): void
}

export interface OperatorClientOptions {
  logger: OperatorLogger
  /** Production passes `powershell.exe`; tests can pass another runtime. */
  command?: string
  args?: string[]
  cwd?: string
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  maxRestarts?: number
}

export interface OperatorStartup {
  version: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const PROTOCOL_VERSION = 1

/**
 * Owns the hidden PowerShell operator process. Communicates with newline
 * delimited JSON and never exposes the operator to the renderer.
 */
export class OperatorClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private readonly exitWaiters = new Set<() => void>()
  private nextId = 1
  private lineBuffer = ''
  private stderrTail = ''
  private ready = false
  private stopping = false
  private restarts = 0
  private startup: OperatorStartup = { version: PROTOCOL_VERSION }
  private startPromise: Promise<OperatorStartup> | null = null

  constructor(private readonly options: OperatorClientOptions) {}

  isReady(): boolean {
    return this.ready && this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<OperatorStartup> {
    this.stopping = false
    this.restarts = 0
    return this.launch()
  }

  private async launch(): Promise<OperatorStartup> {
    if (this.isReady()) return this.startup
    if (this.startPromise) return this.startPromise

    this.startPromise = new Promise<OperatorStartup>((resolve, reject) => {
      const command = this.options.command ?? 'powershell.exe'
      const args = this.options.args ?? []
      const handshakeTimeoutMs = this.options.handshakeTimeoutMs ?? 20_000

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(command, args, {
          cwd: this.options.cwd,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (error) {
        this.startPromise = null
        reject(
          new AppError('UNSUPPORTED', 'The Windows operator could not start.', {
            cause: error
          })
        )
        return
      }

      this.child = child
      this.ready = false
      this.lineBuffer = ''
      this.stderrTail = ''

      // Writes can fail asynchronously when the helper dies mid-request.
      child.stdin.on('error', (error) => {
        this.options.logger.warn('control', `Operator input stream error: ${error.message}`)
      })

      const timer = setTimeout(() => {
        this.ready = false
        this.options.logger.error('control', 'Operator handshake timed out; stopping the helper.')
        this.killChild()
        this.startPromise = null
        reject(
          new AppError(
            'UNSUPPORTED',
            'Windows desktop control is unavailable: the operator helper did not complete its handshake.'
          )
        )
      }, handshakeTimeoutMs)

      const settle = (): void => {
        clearTimeout(timer)
        this.startPromise = null
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        this.consume(chunk, (message) => {
          if (message.ready === true) {
            this.ready = true
            this.startup = {
              version: typeof message.version === 'number' ? message.version : PROTOCOL_VERSION
            }
            settle()
            resolve(this.startup)
            return
          }
          this.handleMessage(message)
        })
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-4000)
      })

      child.on('error', (error) => {
        this.options.logger.error('control', `Operator process error: ${error.message}`)
        if (!this.ready) {
          settle()
          reject(
            new AppError('UNSUPPORTED', 'The Windows operator could not start.', { cause: error })
          )
        }
      })

      child.on('exit', (code, signal) => {
        const unexpected = !this.stopping
        this.ready = false
        this.child = null
        this.startPromise = null
        clearTimeout(timer)
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(
            new AppError('UNSUPPORTED', 'The Windows operator stopped before answering.', {
              internal: `Operator exited with ${code ?? signal} while handling request ${id}.`
            })
          )
          this.pending.delete(id)
        }
        for (const waiter of this.exitWaiters) waiter()
        this.exitWaiters.clear()
        if (unexpected) {
          this.restarts += 1
          this.options.logger.error(
            'control',
            `Operator exited unexpectedly (${code ?? signal}). Restart ${this.restarts}/${
              this.options.maxRestarts ?? 3
            }.${this.stderrTail ? ` ${this.stderrTail.slice(-600)}` : ''}`
          )
        }
        reject(
          new AppError(
            'UNSUPPORTED',
            'Windows desktop control is unavailable: the operator stopped unexpectedly.'
          )
        )
      })
    })

    return this.startPromise
  }

  private consume(chunk: string, handler: (message: Record<string, unknown>) => void): void {
    this.lineBuffer += chunk
    while (true) {
      const newline = this.lineBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.lineBuffer.slice(0, newline).replace(/\r$/, '').trim()
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      if (!line) continue
      let message: Record<string, unknown>
      try {
        const parsed = JSON.parse(line) as unknown
        if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
        message = parsed as Record<string, unknown>
      } catch {
        this.options.logger.warn('control', `Operator emitted unparseable output: ${line.slice(0, 300)}`)
        continue
      }
      handler(message)
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok === true) {
      pending.resolve(message.data)
    } else {
      const text =
        typeof message.error === 'string' && message.error.trim()
          ? message.error
          : 'The Windows operator rejected the request.'
      pending.reject(new AppError('UNSUPPORTED', text))
    }
  }

  async request<T>(
    cmd: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<T> {
    await this.ensureStarted()
    const child = this.child
    if (!child || !this.ready) {
      throw new AppError('UNSUPPORTED', 'Windows desktop control is unavailable.')
    }
    const timeout = timeoutMs ?? this.options.requestTimeoutMs ?? 20_000
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.options.logger.error('control', `Operator request "${cmd}" timed out; restarting helper.`)
        this.killChild()
        reject(
          new AppError(
            'TIMEOUT',
            'The Windows operator timed out without responding. It was restarted; try the action again.'
          )
        )
      }, timeout)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(
          new AppError('UNSUPPORTED', 'The Windows operator is not accepting requests.', {
            cause: error
          })
        )
      }
    })
  }

  private async ensureStarted(): Promise<void> {
    if (this.isReady()) return
    if (this.startPromise) {
      await this.startPromise
      return
    }
    const max = this.options.maxRestarts ?? 3
    if (this.restarts >= max) {
      throw new AppError(
        'UNSUPPORTED',
        'Windows desktop control is unavailable because the operator keeps exiting. Restart IGRIS and try again.'
      )
    }
    await this.launch()
  }

  /** Resolves the next time the operator exits, or immediately if it is down. */
  waitForExit(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return Promise.resolve()
    return new Promise((resolve) => this.exitWaiters.add(resolve))
  }

  async releaseAll(): Promise<void> {
    if (!this.isReady()) return
    try {
      await this.request('releaseAll', {}, 2000)
    } catch {
      // Releasing is best effort; stop() also kills the process.
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) {
      this.ready = false
      return
    }
    try {
      if (this.isReady()) await this.releaseAll()
    } catch {
      // Ignore; the process is being stopped.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.killChild()
        resolve()
      }, 1500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      this.killChild()
    })
    this.ready = false
    this.child = null
  }

  /** Synchronously stops the helper without waiting for a graceful release. */
  dispose(): void {
    this.stopping = true
    this.ready = false
    this.killChild()
    this.child = null
  }

  private killChild(): void {
    const child = this.child
    if (!child) return
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }
}

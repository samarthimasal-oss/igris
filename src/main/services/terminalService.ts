import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'
import type { WorkspaceRepository } from '../storage/repositories'
import { AppError } from '../security/errors'
import { evaluateCommand } from '../security/commandPolicy'
import { redactAndTruncate } from '../security/redaction'
import type { Logger } from './logger'

export interface TerminalResult {
  command: string
  output: string
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
  durationMs: number
  executable: string
}

const LOCAL_BIN_TOOLS = new Set(['tsc', 'vite', 'vitest', 'jest', 'eslint', 'prettier'])

function findInPath(name: string): string | null {
  const path = process.env.PATH ?? process.env.Path ?? ''
  const entries = path.split(';').filter((entry) => entry && !entry.startsWith('.'))
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.com'] : ['']
  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = join(entry, `${name}${extension}`)
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
      } catch {
        // Keep looking.
      }
    }
  }
  return null
}

export class TerminalService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly logger: Logger,
    private readonly maxTimeoutMs = 300_000
  ) {}

  private workspace(id: string): Workspace {
    const workspace = this.workspaces.get(id)
    if (!workspace) throw new AppError('NOT_FOUND', 'Project not found.')
    if (!existsSync(workspace.path)) {
      throw new AppError('FILESYSTEM', 'The project folder is no longer available.')
    }
    return workspace
  }

  resolveExecutable(name: string, workspacePath: string): string {
    if (LOCAL_BIN_TOOLS.has(name)) {
      const local = join(workspacePath, 'node_modules', '.bin', `${name}.cmd`)
      const localUnix = join(workspacePath, 'node_modules', '.bin', name)
      if (existsSync(local)) return local
      if (existsSync(localUnix)) return localUnix
    }
    const found = findInPath(name)
    if (!found) {
      throw new AppError(
        'UNSUPPORTED',
        `${name} is not installed or not available on PATH. Install it and reopen IGRIS.`
      )
    }
    return found
  }

  async run(
    workspaceId: string,
    command: string,
    options: {
      signal?: AbortSignal
      timeoutMs?: number
      approvalSource?: string
    } = {}
  ): Promise<TerminalResult> {
    const workspace = this.workspace(workspaceId)
    const evaluation = evaluateCommand(command)
    const executablePath = this.resolveExecutable(evaluation.executable, workspace.path)
    const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 120_000, this.maxTimeoutMs))
    const started = Date.now()

    return new Promise<TerminalResult>((resolve, reject) => {
      let output = ''
      let timedOut = false
      let cancelled = false
      let settled = false
      let child: ReturnType<typeof spawn>

      const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
      delete env.ELECTRON_RUN_AS_NODE

      const args: string[] = []
      let actualCommand = executablePath
      const isShellScript = /\.(cmd|bat)$/i.test(executablePath)
      if (isShellScript) {
        const quoted = [executablePath, ...evaluation.args]
          .map((part) => `"${part.replace(/"/g, '""')}"`)
          .join(' ')
        actualCommand = process.env.ComSpec ?? 'cmd.exe'
        args.push('/d', '/s', '/c', quoted)
      } else {
        args.push(...evaluation.args)
      }

      try {
        child = spawn(actualCommand, args, {
          cwd: workspace.path,
          windowsHide: true,
          shell: false,
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        reject(
          new AppError('TERMINAL', 'The command could not be started.', {
            cause: error,
            internal: `spawn ${actualCommand}`
          })
        )
        return
      }

      const append = (chunk: Buffer): void => {
        if (output.length > 220_000) return
        output += chunk.toString('utf8')
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)

      const killTree = (): void => {
        if (!child.pid) {
          child.kill()
          return
        }
        try {
          const killer = spawn(
            process.platform === 'win32' ? 'taskkill.exe' : 'kill',
            process.platform === 'win32'
              ? ['/pid', String(child.pid), '/T', '/F']
              : ['-TERM', String(child.pid)],
            { windowsHide: true, stdio: 'ignore' }
          )
          killer.unref()
        } catch {
          child.kill()
        }
      }

      const timer = setTimeout(() => {
        timedOut = true
        killTree()
      }, timeoutMs)

      const onAbort = (): void => {
        cancelled = true
        killTree()
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        const cleanOutput = redactAndTruncate(output.trim(), 200_000)
        const result: TerminalResult = {
          command: evaluation.display,
          output: cleanOutput || '(no output)',
          exitCode,
          timedOut,
          cancelled,
          durationMs: Date.now() - started,
          executable: executablePath
        }
        this.logger.info(
          'terminal',
          `Ran "${evaluation.display}" in ${workspace.name}; exit=${exitCode ?? 'none'}${
            timedOut ? ' timed out' : ''
          }${cancelled ? ' cancelled' : ''}`
        )
        resolve(result)
      }

      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        reject(
          new AppError('TERMINAL', 'The command failed to start.', {
            cause: error,
            internal: `${actualCommand}: ${error.message}`
          })
        )
      })
      child.on('close', (code) => finish(code))
    })
  }

  async detectTestCommand(workspaceId: string): Promise<{ command: string; reason: string }> {
    const workspace = this.workspace(workspaceId)
    const has = (name: string): boolean => existsSync(join(workspace.path, name))
    if (has('package.json')) {
      const packageManager = has('pnpm-lock.yaml')
        ? 'pnpm'
        : has('yarn.lock')
          ? 'yarn'
          : has('bun.lockb') || has('bun.lock')
            ? 'bun'
            : 'npm'
      return {
        command: packageManager === 'npm' ? 'npm test' : `${packageManager} test`,
        reason: 'Detected a package.json test script'
      }
    }
    if (has('Cargo.toml')) return { command: 'cargo test', reason: 'Detected a Cargo project' }
    if (has('go.mod')) return { command: 'go test ./...', reason: 'Detected a Go module' }
    if (has('pytest.ini') || has('pyproject.toml') || has('tests')) {
      return { command: 'pytest', reason: 'Detected a Python test setup' }
    }
    if (has('pom.xml')) return { command: 'mvn test', reason: 'Detected a Maven project' }
    if (has('build.gradle') || has('build.gradle.kts')) {
      return { command: 'gradle test', reason: 'Detected a Gradle project' }
    }
    const { readdirSync } = await import('node:fs')
    if (readdirSync(workspace.path).some((name) => name.endsWith('.sln'))) {
      return { command: 'dotnet test', reason: 'Detected a .NET solution' }
    }
    throw new AppError(
      'UNSUPPORTED',
      'IGRIS could not detect a test command for this project. Add one or run a command explicitly.'
    )
  }

  async runTests(workspaceId: string, signal?: AbortSignal): Promise<TerminalResult> {
    const detected = await this.detectTestCommand(workspaceId)
    this.logger.info('terminal', `Detected test command: ${detected.command} (${detected.reason})`)
    return this.run(workspaceId, detected.command, { signal, timeoutMs: 180_000 })
  }
}

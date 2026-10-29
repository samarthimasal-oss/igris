import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { AppInfo, WindowInfo } from '@shared/types'
import { AppError } from '../security/errors'

const execFileAsync = promisify(execFile)

interface AppDefinition {
  id: string
  name: string
  description: string
  executable?: () => string | null
  protocol?: string
}

function systemExe(name: string): string | null {
  const root = process.env.WINDIR ?? 'C:\\Windows'
  const candidate = join(root, 'System32', name)
  return existsSync(candidate) ? candidate : null
}

function findCode(): string | null {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft VS Code', 'Code.exe')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

function findTerminal(): string | null {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe'),
    join(process.env.ProgramFiles ?? '', 'WindowsApps', 'wt.exe')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

const APPS: AppDefinition[] = [
  {
    id: 'notepad',
    name: 'Notepad',
    description: 'Windows text editor',
    executable: () => systemExe('notepad.exe')
  },
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Windows calculator',
    executable: () => systemExe('calc.exe')
  },
  {
    id: 'explorer',
    name: 'File Explorer',
    description: 'Windows file browser',
    executable: () => systemExe('explorer.exe')
  },
  {
    id: 'paint',
    name: 'Paint',
    description: 'Windows drawing app',
    executable: () => systemExe('mspaint.exe')
  },
  {
    id: 'terminal',
    name: 'Windows Terminal',
    description: 'Modern Windows terminal',
    executable: findTerminal
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    description: 'Code editor (if installed)',
    executable: findCode
  },
  {
    id: 'settings',
    name: 'Windows Settings',
    description: 'Open the Windows settings app',
    protocol: 'ms-settings:'
  }
]

export class AppService {
  list(): AppInfo[] {
    return APPS.map((app) => {
      const available = app.protocol ? true : Boolean(app.executable?.())
      return {
        id: app.id,
        name: app.name,
        description: app.description,
        available,
        source: 'builtin' as const
      }
    })
  }

  private find(id: string): AppDefinition {
    const app = APPS.find((entry) => entry.id === id)
    if (!app) throw new AppError('VALIDATION', 'That application is not in the IGRIS allowlist.')
    return app
  }

  async launch(id: string): Promise<string> {
    const app = this.find(id)
    if (app.protocol) {
      await shell.openExternal(app.protocol)
      return `Opened ${app.name}.`
    }
    const executable = app.executable?.()
    if (!executable) {
      throw new AppError('NOT_FOUND', `${app.name} is not installed on this computer.`)
    }
    return new Promise<string>((resolve, reject) => {
      const startedAt = Date.now()
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(executable, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
      } catch (error) {
        reject(
          new AppError('INTERNAL', `${app.name} could not be started.`, {
            cause: error
          })
        )
        return
      }
      let settled = false
      child.once('error', (error) => {
        if (settled) return
        settled = true
        reject(
          new AppError('INTERNAL', `${app.name} could not be started.`, {
            cause: error,
            internal: error.message
          })
        )
      })
      child.once('exit', (code) => {
        if (settled) return
        settled = true
        if (code && code !== 0 && Date.now() - startedAt < 1500) {
          reject(new AppError('INTERNAL', `${app.name} exited with code ${code} during launch.`))
        } else {
          resolve(`Launch command accepted for ${app.name}. Windows did not report an error.`)
        }
      })
      child.unref()
      setTimeout(() => {
        if (settled) return
        settled = true
        if (child.pid) {
          resolve(`Launched ${app.name} (process ${child.pid}).`)
        } else {
          reject(new AppError('INTERNAL', `${app.name} did not report a process.`))
        }
      }, 700)
    })
  }

  async listWindows(): Promise<WindowInfo[]> {
    const script = [
      "$ErrorActionPreference='Stop'",
      'Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |',
      'Select-Object -First 60 @{Name=\'title\';Expression={$_.MainWindowTitle}},',
      "@{Name='process';Expression={$_.ProcessName}},@{Name='processId';Expression={$_.Id}} |",
      'ConvertTo-Json -Compress'
    ].join(' ')
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 15000, windowsHide: true, maxBuffer: 512 * 1024 }
      )
      const trimmed = stdout.trim()
      if (!trimmed) return []
      const parsed = JSON.parse(trimmed) as
        | { title?: string; process?: string; processId?: number }
        | Array<{ title?: string; process?: string; processId?: number }>
      return (Array.isArray(parsed) ? parsed : [parsed])
        .map((entry) => ({
          title: String(entry.title ?? '').slice(0, 300),
          process: String(entry.process ?? ''),
          processId: Number(entry.processId ?? 0)
        }))
        .filter((entry) => entry.title)
    } catch (error) {
      throw new AppError('INTERNAL', 'IGRIS could not read the Windows process list.', {
        cause: error
      })
    }
  }

  executablePath(id: string): string | null {
    return this.find(id).executable?.() ?? null
  }
}

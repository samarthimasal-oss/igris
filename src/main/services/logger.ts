import type { LogEntry } from '@shared/types'
import type { LogRepository } from '../storage/repositories'
import { redactSecrets } from '../security/redaction'

export class Logger {
  constructor(
    private readonly repo: LogRepository,
    private readonly enabled: () => boolean,
    private readonly isDev: boolean
  ) {}

  private write(level: LogEntry['level'], scope: string, message: string): void {
    const safe = redactSecrets(message).slice(0, 4000)
    if (this.isDev) {
      const line = `[${level}] ${scope}: ${safe}`
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    }
    if (!this.enabled()) return
    try {
      this.repo.add(level, scope, safe)
    } catch {
      // Logging must never take the application down.
    }
  }

  info(scope: string, message: string): void {
    this.write('info', scope, message)
  }

  warn(scope: string, message: string): void {
    this.write('warn', scope, message)
  }

  error(scope: string, message: string): void {
    this.write('error', scope, message)
  }
}

export type { LogEntry }

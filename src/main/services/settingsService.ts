import { EventEmitter } from 'node:events'
import type { DeepPartial, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { clampSettings, mergeSettings, normalizeSettings } from '@shared/settings'
import type { SettingsRepository } from '../storage/repositories'

export class SettingsService extends EventEmitter {
  private current: Settings

  constructor(private readonly repo: SettingsRepository) {
    super()
    const stored = repo.get()
    if (stored === null) {
      this.current = structuredClone(DEFAULT_SETTINGS)
      repo.save(this.current)
    } else {
      this.current = clampSettings(normalizeSettings(stored))
    }
  }

  get(): Settings {
    return structuredClone(this.current)
  }

  update(patch: DeepPartial<Settings>): Settings {
    const merged = clampSettings(mergeSettings(this.current, patch))
    this.current = merged
    this.repo.save(merged)
    this.emit('changed', this.get())
    return this.get()
  }

  raw(): Settings {
    return this.current
  }
}

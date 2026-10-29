import type { DeepPartial, Settings } from './types'
import { DEFAULT_SETTINGS } from './defaults'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const merge = (target: unknown, source: unknown): unknown => {
    if (!isPlainObject(source)) return source
    const result: Record<string, unknown> = isPlainObject(target) ? { ...target } : {}
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue
      result[key] = isPlainObject(value) ? merge(result[key], value) : value
    }
    return result
  }
  return merge(base, patch) as Settings
}

export function normalizeSettings(raw: unknown): Settings {
  if (!isPlainObject(raw)) return structuredClone(DEFAULT_SETTINGS)
  return mergeSettings(structuredClone(DEFAULT_SETTINGS), raw as DeepPartial<Settings>)
}

export function clampSettings(settings: Settings): Settings {
  const s = structuredClone(settings)
  s.ai.contextMessages = Math.min(80, Math.max(4, Math.round(s.ai.contextMessages)))
  s.ai.maxToolIterations = Math.min(12, Math.max(1, Math.round(s.ai.maxToolIterations)))
  s.ai.temperature = Math.min(2, Math.max(0, s.ai.temperature))
  s.privacy.retentionDays = Math.min(3650, Math.max(0, Math.round(s.privacy.retentionDays)))
  if (!['azure', 'violet', 'silver'].includes(s.appearance.accent)) s.appearance.accent = 'azure'
  if (!['low', 'medium', 'high'].includes(s.appearance.quality)) s.appearance.quality = 'high'
  if (!['calm', 'balanced', 'lively'].includes(s.appearance.animationIntensity)) {
    s.appearance.animationIntensity = 'balanced'
  }
  return s
}

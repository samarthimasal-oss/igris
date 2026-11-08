import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { clampSettings, mergeSettings, normalizeSettings } from '../../src/shared/settings'

describe('mergeSettings', () => {
  it('deep-merges a partial patch without dropping siblings', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      appearance: { accent: 'violet' },
      ai: { contextMessages: 8 },
      onboardingComplete: true
    })
    expect(merged.appearance.accent).toBe('violet')
    expect(merged.appearance.quality).toBe(DEFAULT_SETTINGS.appearance.quality)
    expect(merged.ai.contextMessages).toBe(8)
    expect(merged.ai.temperature).toBe(DEFAULT_SETTINGS.ai.temperature)
    expect(merged.onboardingComplete).toBe(true)
  })

  it('does not mutate the base settings', () => {
    const base = structuredClone(DEFAULT_SETTINGS)
    mergeSettings(base, { appearance: { accent: 'silver' } })
    expect(base.appearance.accent).toBe('azure')
  })
})

describe('normalizeSettings', () => {
  it('falls back to defaults for non-object input', () => {
    expect(normalizeSettings('broken')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('repairs a partial stored object', () => {
    const settings = normalizeSettings({
      appearance: { accent: 'violet' },
      permissions: { terminal: true }
    })
    expect(settings.appearance.accent).toBe('violet')
    expect(settings.appearance.show3d).toBe(true)
    expect(settings.permissions.terminal).toBe(true)
    expect(settings.permissions.filesystem).toBe(false)
    expect(settings.ai.maxToolIterations).toBe(DEFAULT_SETTINGS.ai.maxToolIterations)
  })

  it('keeps computer control disabled for existing and new installs', () => {
    expect(DEFAULT_SETTINGS.permissions.desktopControl).toBe(false)
    expect(DEFAULT_SETTINGS.permissions.browserControl).toBe(false)
    const upgraded = normalizeSettings({ permissions: { terminal: true } })
    expect(upgraded.permissions.desktopControl).toBe(false)
    expect(upgraded.permissions.browserControl).toBe(false)
  })

  it('preserves an explicitly enabled control permission', () => {
    const settings = normalizeSettings({
      permissions: { desktopControl: true, browserControl: true }
    })
    expect(settings.permissions.desktopControl).toBe(true)
    expect(settings.permissions.browserControl).toBe(true)
  })
})

describe('clampSettings', () => {
  it('limits numeric ranges', () => {
    const input = structuredClone(DEFAULT_SETTINGS)
    input.ai.contextMessages = 500
    input.ai.maxToolIterations = 0
    input.ai.temperature = 9
    input.privacy.retentionDays = -4
    const output = clampSettings(input)
    expect(output.ai.contextMessages).toBe(80)
    expect(output.ai.maxToolIterations).toBe(1)
    expect(output.ai.temperature).toBe(2)
    expect(output.privacy.retentionDays).toBe(0)
  })

  it('allows long autonomous control runs but caps them', () => {
    const input = structuredClone(DEFAULT_SETTINGS)
    input.ai.maxToolIterations = 500
    const output = clampSettings(input)
    expect(output.ai.maxToolIterations).toBe(60)
  })

  it('resets unknown enum values to safe defaults', () => {
    const input = structuredClone(DEFAULT_SETTINGS)
    input.appearance.accent = 'neon' as typeof input.appearance.accent
    input.appearance.quality = 'ultra' as typeof input.appearance.quality
    input.appearance.animationIntensity = 'frantic' as typeof input.appearance.animationIntensity
    const output = clampSettings(input)
    expect(output.appearance.accent).toBe('azure')
    expect(output.appearance.quality).toBe('high')
    expect(output.appearance.animationIntensity).toBe('balanced')
  })

  it('rounds fractional values', () => {
    const input = structuredClone(DEFAULT_SETTINGS)
    input.ai.contextMessages = 12.6
    input.privacy.retentionDays = 30.4
    const output = clampSettings(input)
    expect(output.ai.contextMessages).toBe(13)
    expect(output.privacy.retentionDays).toBe(30)
  })
})

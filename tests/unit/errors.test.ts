import { describe, expect, it } from 'vitest'
import {
  AppError,
  httpStatusToError,
  normalizeError,
  serializeError
} from '../../src/main/security/errors'

describe('AppError', () => {
  it('marks transient failures as retryable', () => {
    expect(new AppError('NETWORK', 'offline').retryable).toBe(true)
    expect(new AppError('RATE_LIMIT', 'slow down').retryable).toBe(true)
    expect(new AppError('AUTH', 'bad key').retryable).toBe(false)
    expect(new AppError('VALIDATION', 'bad input').retryable).toBe(false)
  })

  it('keeps a private internal message out of the user message', () => {
    const error = new AppError('INTERNAL', 'Try again.', { internal: 'stack detail' })
    expect(error.userMessage).toBe('Try again.')
    expect(error.message).toBe('stack detail')
  })
})

describe('normalizeError', () => {
  it('preserves AppError instances', () => {
    const original = new AppError('PERMISSION', 'Not allowed.')
    expect(normalizeError(original)).toBe(original)
  })

  it('maps aborts to cancellation', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const normalized = normalizeError(abort)
    expect(normalized.code).toBe('CANCELLED')
  })

  it('does not expose raw internal errors to the interface', () => {
    const normalized = normalizeError(new Error('database path C:\\secret\\igris.db'))
    expect(normalized.code).toBe('INTERNAL')
    expect(normalized.userMessage).toBe('Something went wrong.')
    expect(normalized.message).toContain('C:\\secret')
  })
})

describe('serializeError', () => {
  it('returns only the public shape', () => {
    const serialized = serializeError(
      new AppError('RATE_LIMIT', 'Wait and retry.', { internal: 'HTTP 429: quota detail' })
    )
    expect(serialized).toEqual({ code: 'RATE_LIMIT', message: 'Wait and retry.', retryable: true })
    expect(JSON.stringify(serialized)).not.toContain('quota detail')
  })
})

describe('httpStatusToError', () => {
  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [404, 'PROVIDER'],
    [429, 'RATE_LIMIT'],
    [402, 'QUOTA'],
    [500, 'PROVIDER'],
    [503, 'PROVIDER'],
    [418, 'PROVIDER']
  ])('maps HTTP %i to %s', (status, code) => {
    expect(httpStatusToError(status, 'provider body').code).toBe(code)
  })

  it('exposes retry guidance for transient provider failures', () => {
    expect(httpStatusToError(429, '').retryable).toBe(true)
    expect(httpStatusToError(503, '').retryable).toBe(true)
    expect(httpStatusToError(401, '').retryable).toBe(false)
  })
})

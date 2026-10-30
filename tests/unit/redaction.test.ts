import { describe, expect, it } from 'vitest'
import { redactAndTruncate, redactSecrets, truncate } from '../../src/main/security/redaction'

describe('redactSecrets', () => {
  it('redacts provider API keys', () => {
    const input =
      'openai=sk-proj-abcdefghijklmnop anthropic=sk-ant-api03-abcdefghijklmnop google=AIzaSyA1234567890abcdefghijkl gemini=AQ.SyntheticTestKey1234567890abcdef'
    const output = redactSecrets(input)
    expect(output).not.toContain('sk-proj-abcdefghijklmnop')
    expect(output).not.toContain('sk-ant-api03-abcdefghijklmnop')
    expect(output).not.toContain('AIzaSyA1234567890abcdefghijkl')
    expect(output).not.toContain('AQ.SyntheticTestKey1234567890abcdef')
    expect(output).toContain('[redacted-openai-key]')
    expect(output).toContain('[redacted-anthropic-key]')
    expect(output).toContain('[redacted-google-key]')
  })

  it('redacts bearer tokens and labelled secrets', () => {
    const output = redactSecrets(
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz\napiKey: "super-secret-value"\npassword=hunter2'
    )
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(output).not.toContain('super-secret-value')
    expect(output).not.toContain('hunter2')
    expect(output).toContain('Bearer [redacted]')
  })

  it('redacts tokens in query strings and GitHub credentials', () => {
    const output = redactSecrets(
      'https://example.com/cb?access_token=abc123&x=1 ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    )
    expect(output).not.toContain('abc123')
    expect(output).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(output).toContain('access_token=[redacted]')
    expect(output).toContain('[redacted-github-token]')
  })
})

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('marks omitted characters', () => {
    const output = truncate('abcdefghij', 4)
    expect(output).toContain('abcd')
    expect(output).toContain('6 characters omitted')
  })

  it('redacts before truncating', () => {
    const output = redactAndTruncate('key sk-abcdefghijklmnop tail', 10)
    expect(output).not.toContain('sk-abcdefghijklmnop')
  })
})

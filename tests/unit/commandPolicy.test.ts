import { describe, expect, it } from 'vitest'
import { evaluateCommand, tokenizeCommand, TERMINAL_ALLOWLIST } from '../../src/main/security/commandPolicy'
import { AppError } from '../../src/main/security/errors'

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
    throw new Error('Expected the operation to throw.')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

describe('tokenizeCommand', () => {
  it('keeps quoted arguments together', () => {
    expect(tokenizeCommand('git commit -m "a precise message"')).toEqual([
      'git',
      'commit',
      '-m',
      'a precise message'
    ])
  })

  it('supports single quotes and empty quoted arguments', () => {
    expect(tokenizeCommand("node -e 'console.log(1)' ''")).toEqual([
      'node',
      '-e',
      'console.log(1)',
      ''
    ])
  })

  it('rejects shell operators and expansion characters', () => {
    expectCode(() => tokenizeCommand('npm run build && del secrets.txt'), 'VALIDATION')
    expectCode(() => tokenizeCommand('git log | more'), 'VALIDATION')
    expectCode(() => tokenizeCommand('echo %PATH%'), 'VALIDATION')
  })

  it('rejects empty commands and unclosed quotes', () => {
    expectCode(() => tokenizeCommand('   '), 'VALIDATION')
    expectCode(() => tokenizeCommand('node "unfinished'), 'VALIDATION')
  })
})

describe('evaluateCommand', () => {
  it('resolves an allowlisted executable with an explicit risk level', () => {
    const evaluation = evaluateCommand('npm run build')
    expect(evaluation).toMatchObject({
      executable: 'npm',
      args: ['run', 'build'],
      display: 'npm run build',
      risk: 'medium'
    })
    expect(TERMINAL_ALLOWLIST).toContain('npm')
  })

  it('treats dependency installs and npx as high risk', () => {
    expect(evaluateCommand('npm ci').risk).toBe('high')
    expect(evaluateCommand('npx create-igris-app').risk).toBe('high')
  })

  it('blocks destructive or remote-mutating git operations', () => {
    expectCode(() => evaluateCommand('git push origin main'), 'PERMISSION')
    expectCode(() => evaluateCommand('git reset --hard HEAD~1'), 'PERMISSION')
    expectCode(() => evaluateCommand('git clean -fdx'), 'PERMISSION')
    expectCode(() => evaluateCommand('git filter-branch --force'), 'PERMISSION')
  })

  it('marks state-changing git commands high risk', () => {
    expect(evaluateCommand('git commit -m "checkpoint"').risk).toBe('high')
    expect(evaluateCommand('git status').risk).toBe('medium')
  })

  it('blocks publishing and credential commands', () => {
    expectCode(() => evaluateCommand('npm publish'), 'PERMISSION')
    expectCode(() => evaluateCommand('npm login'), 'PERMISSION')
    expect(evaluateCommand('pip install requests').risk).toBe('high')
  })

  it('rejects executables outside the allowlist', () => {
    expectCode(() => evaluateCommand('powershell -Command Get-Process'), 'UNSUPPORTED')
    expectCode(() => evaluateCommand('cmd /c dir'), 'UNSUPPORTED')
  })
})

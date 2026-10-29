import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WorkspaceBoundary,
  assertSafeRelativePath,
  joinInside
} from '../../src/main/security/pathGuard'
import { AppError } from '../../src/main/security/errors'

const root = mkdtempSync(join(tmpdir(), 'igris-pathguard-'))
mkdirSync(join(root, 'src'))
writeFileSync(join(root, 'src', 'main.ts'), 'export const ok = true\n')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
    throw new Error('Expected the operation to throw.')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

describe('WorkspaceBoundary', () => {
  const boundary = new WorkspaceBoundary(root)

  it('resolves files inside the approved workspace', () => {
    expect(boundary.resolve('src/main.ts')).toBe(join(root, 'src', 'main.ts'))
    expect(boundary.relative(join(root, 'src', 'main.ts'))).toBe('src/main.ts')
  })

  it('allows a missing target only when explicitly requested', () => {
    expect(boundary.resolve('src/new.ts', { allowMissing: true })).toBe(join(root, 'src', 'new.ts'))
    expectCode(() => boundary.resolve('src/new.ts'), 'NOT_FOUND')
  })

  it('rejects traversal and absolute paths', () => {
    expectCode(() => boundary.resolve('../outside.txt'), 'FILESYSTEM')
    expectCode(() => boundary.resolve('src/../../outside.txt'), 'FILESYSTEM')
    expectCode(() => boundary.resolve('C:\\Windows\\system.ini'), 'FILESYSTEM')
    expectCode(() => boundary.resolve('~/secret.txt'), 'FILESYSTEM')
  })

  it('rejects null bytes', () => {
    expectCode(() => boundary.resolve('src/main.ts\0.png'), 'VALIDATION')
  })

  it('rejects a junction that escapes the workspace', () => {
    const outside = mkdtempSync(join(tmpdir(), 'igris-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'not yours\n')
    const link = join(root, 'escape')
    try {
      symlinkSync(outside, link, 'junction')
    } catch {
      rmSync(outside, { recursive: true, force: true })
      return
    }
    try {
      expectCode(() => boundary.resolve('escape/secret.txt'), 'FILESYSTEM')
    } finally {
      rmSync(link, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('relative path helpers', () => {
  it('normalizes safe relative paths', () => {
    expect(assertSafeRelativePath('src\\components\\App.tsx')).toBe('src/components/App.tsx')
    expect(assertSafeRelativePath('src/./main.ts')).toBe('src/main.ts')
  })

  it('rejects traversal, absolute paths and empty input', () => {
    expectCode(() => assertSafeRelativePath('../secret.txt'), 'FILESYSTEM')
    expectCode(() => assertSafeRelativePath('..\\secret.txt'), 'FILESYSTEM')
    expectCode(() => assertSafeRelativePath('/etc/passwd'), 'FILESYSTEM')
    expectCode(() => assertSafeRelativePath('C:\\Windows\\win.ini'), 'FILESYSTEM')
    expectCode(() => assertSafeRelativePath('   '), 'VALIDATION')
  })

  it('joins only paths that remain inside the root', () => {
    expect(joinInside(root, 'src/main.ts')).toBe(join(root, 'src', 'main.ts'))
    expectCode(() => joinInside(root, '../outside.txt'), 'FILESYSTEM')
  })
})

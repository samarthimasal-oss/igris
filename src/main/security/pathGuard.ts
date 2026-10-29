import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { AppError } from './errors'

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Confines filesystem work to one user-approved workspace.
 * Both lexical paths and real paths (symlinks/junctions) are checked.
 */
export class WorkspaceBoundary {
  readonly root: string
  readonly realRoot: string

  constructor(root: string) {
    const resolved = resolve(root)
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new AppError('FILESYSTEM', 'That project folder is unavailable.', {
        internal: `Not a directory: ${resolved}`
      })
    }
    this.root = resolved
    this.realRoot = realpathSync.native(resolved)
  }

  resolve(relativePath: string, options: { allowMissing?: boolean } = {}): string {
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
      throw new AppError('VALIDATION', 'The file path is invalid.')
    }
    const cleaned = relativePath.replace(/^[/\\]+/, '').trim()
    if (!cleaned && !options.allowMissing) {
      throw new AppError('VALIDATION', 'A file path is required.')
    }
    if (cleaned.includes(':') || cleaned.startsWith('~')) {
      throw new AppError('FILESYSTEM', 'Only paths inside the approved workspace are allowed.')
    }
    const candidate = resolve(this.root, cleaned)
    if (!inside(this.root, candidate)) {
      throw new AppError('FILESYSTEM', 'That path is outside the approved workspace.')
    }

    const existing = this.nearestExisting(candidate)
    if (existing) {
      let real: string
      try {
        real = realpathSync.native(existing)
      } catch {
        throw new AppError('FILESYSTEM', 'The path could not be resolved safely.')
      }
      if (!inside(this.realRoot, real)) {
        throw new AppError('FILESYSTEM', 'That path escapes the approved workspace through a link.')
      }
    }

    if (!options.allowMissing) {
      if (!existsSync(candidate)) {
        throw new AppError('NOT_FOUND', 'That file or folder does not exist.')
      }
      const info = lstatSync(candidate)
      if (info.isSymbolicLink()) {
        const real = realpathSync.native(candidate)
        if (!inside(this.realRoot, real)) {
          throw new AppError('FILESYSTEM', 'That symbolic link points outside the approved workspace.')
        }
      }
    }
    return candidate
  }

  private nearestExisting(candidate: string): string | null {
    let current = candidate
    for (let i = 0; i < 40; i += 1) {
      if (existsSync(current)) return current
      const parent = resolve(current, '..')
      if (parent === current) return null
      current = parent
    }
    return null
  }

  relative(absolutePath: string): string {
    if (!inside(this.root, absolutePath)) {
      throw new AppError('FILESYSTEM', 'That path is outside the approved workspace.')
    }
    return relative(this.root, absolutePath).split(sep).join('/')
  }
}

export function assertSafeRelativePath(relativePath: string): string {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new AppError('VALIDATION', 'A relative path is required.')
  }
  if (relativePath.includes('\0') || isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new AppError('FILESYSTEM', 'Only relative paths inside the workspace are allowed.')
  }
  const normalized = normalize(relativePath).replace(/\\/g, '/')
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new AppError('FILESYSTEM', 'Path traversal is not allowed.')
  }
  return normalized
}

export function joinInside(root: string, relativePath: string): string {
  const clean = assertSafeRelativePath(relativePath)
  const candidate = join(root, clean)
  if (!inside(resolve(root), candidate)) {
    throw new AppError('FILESYSTEM', 'That path is outside the approved workspace.')
  }
  return candidate
}

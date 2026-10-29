import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import type {
  FileHit,
  FilePreview,
  ProjectScan,
  TreeNode,
  Workspace
} from '@shared/types'
import type { WorkspaceRepository } from '../storage/repositories'
import { AppError } from '../security/errors'
import { assertSafeRelativePath, joinInside, WorkspaceBoundary } from '../security/pathGuard'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'release',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'target',
  'venv',
  '.venv',
  '__pycache__',
  'coverage',
  '.idea',
  '.gradle',
  'bin',
  'obj'
])

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.css', '.scss',
  '.sass', '.less', '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.rs', '.py', '.rb',
  '.go', '.java', '.kt', '.kts', '.cs', '.csproj', '.sln', '.c', '.h', '.cpp', '.hpp', '.cc',
  '.sh', '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql', '.env', '.example', '.txt',
  '.ini', '.cfg', '.conf', '.vue', '.svelte', '.astro', '.dart', '.swift', '.lua', '.php',
  '.ex', '.exs', '.erl', '.hrl', '.proto', '.dockerfile', '.gitignore', '.editorconfig'
])

const LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.xml': 'xml',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.rs': 'rust',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.sh': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.vue': 'vue',
  '.svelte': 'svelte'
}

export interface FileWriteResult {
  path: string
  bytes: number
  backupPath: string | null
}

export class FileService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly backupRoot: string
  ) {}

  workspace(id: string): Workspace {
    const workspace = this.workspaces.get(id)
    if (!workspace) throw new AppError('NOT_FOUND', 'Project not found. Add it again from Projects.')
    return workspace
  }

  boundary(workspaceId: string): { workspace: Workspace; boundary: WorkspaceBoundary } {
    const workspace = this.workspace(workspaceId)
    return { workspace, boundary: new WorkspaceBoundary(workspace.path) }
  }

  scan(workspaceId: string): ProjectScan {
    const { workspace, boundary } = this.boundary(workspaceId)
    let files = 0
    let directories = 0
    let entries = 0
    let truncated = false
    const maxEntries = 1600
    const maxDepth = 7

    const walk = (absolute: string, depth: number): TreeNode[] => {
      if (depth > maxDepth || entries >= maxEntries) {
        truncated = true
        return []
      }
      let dirents
      try {
        dirents = readdirSync(absolute, { withFileTypes: true })
      } catch {
        return []
      }
      const nodes: TreeNode[] = []
      const sorted = dirents
        .filter((entry) => !entry.isSymbolicLink())
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      for (const entry of sorted) {
        if (entries >= maxEntries) {
          truncated = true
          break
        }
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
        if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue
        const absoluteChild = join(absolute, entry.name)
        const relativeChild = relative(boundary.root, absoluteChild).split('\\').join('/')
        if (entry.isDirectory()) {
          directories += 1
          entries += 1
          nodes.push({
            name: entry.name,
            path: relativeChild,
            type: 'dir',
            children: walk(absoluteChild, depth + 1)
          })
        } else if (entry.isFile()) {
          files += 1
          entries += 1
          nodes.push({ name: entry.name, path: relativeChild, type: 'file' })
        }
      }
      return nodes
    }

    const tree = walk(boundary.root, 0)
    const detected = new Set<string>()
    const topLevel = readdirSync(boundary.root, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .slice(0, 80)

    const has = (name: string): boolean => topLevel.includes(name)
    if (has('package.json')) {
      detected.add('Node.js')
      try {
        const pkg = JSON.parse(
          readFileSync(join(boundary.root, 'package.json'), 'utf8').slice(0, 300_000)
        ) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
          scripts?: Record<string, string>
        }
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
        if (deps.react) detected.add('React')
        if (deps.electron) detected.add('Electron')
        if (deps['@tauri-apps/api']) detected.add('Tauri')
        if (deps.next) detected.add('Next.js')
        if (deps.vite) detected.add('Vite')
        if (deps.typescript) detected.add('TypeScript')
        if (pkg.scripts?.test) detected.add('npm test script')
      } catch {
        // A malformed manifest is reported by tests, not by the scanner.
      }
      if (has('pnpm-lock.yaml')) detected.add('pnpm')
      else if (has('yarn.lock')) detected.add('Yarn')
      else if (has('package-lock.json')) detected.add('npm')
    }
    if (has('Cargo.toml')) detected.add('Rust / Cargo')
    if (has('pyproject.toml') || has('requirements.txt')) detected.add('Python')
    if (has('go.mod')) detected.add('Go')
    if (has('pom.xml')) detected.add('Maven')
    if (has('build.gradle') || has('build.gradle.kts')) detected.add('Gradle')
    if (has('CMakeLists.txt')) detected.add('CMake')
    if (has('.sln') || topLevel.some((name) => name.endsWith('.sln'))) detected.add('.NET')
    if (has('index.html')) detected.add('HTML')
    if (has('Dockerfile')) detected.add('Docker')

    const entryCandidates = [
      'src/main.tsx',
      'src/main.ts',
      'src/index.tsx',
      'src/index.ts',
      'src/App.tsx',
      'src/App.ts',
      'index.ts',
      'index.js',
      'main.py',
      'app.py',
      'manage.py',
      'src/main.rs',
      'src/lib.rs',
      'Program.cs',
      'main.go',
      'src/App.jsx'
    ]
    const entryPoints = entryCandidates.filter((candidate) =>
      existsSync(join(boundary.root, candidate))
    )

    const kind = [...detected][0] ?? null
    if (kind) this.workspaces.setKind(workspace.id, kind)
    this.workspaces.touch(workspace.id)

    return {
      workspace: this.workspaces.get(workspace.id) ?? workspace,
      tree,
      files,
      directories,
      truncated,
      detected: [...detected],
      entryPoints,
      topLevel
    }
  }

  preview(workspaceId: string, relativePath: string): FilePreview {
    const { boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath)
    const stat = statSync(absolute)
    if (!stat.isFile()) throw new AppError('VALIDATION', 'That path is not a file.')
    if (stat.size > 5_000_000) {
      throw new AppError('FILESYSTEM', 'That file is larger than 5 MB. Open it in your editor instead.')
    }
    const buffer = readFileSync(absolute)
    const binary = buffer.includes(0)
    const isText = !binary && (stat.size < 5_000_000)
    const limit = 250_000
    const content = isText ? buffer.subarray(0, limit).toString('utf8') : ''
    const ext = extname(absolute).toLowerCase()
    return {
      path: relativePath.split('\\').join('/'),
      name: basename(absolute),
      content,
      size: stat.size,
      truncated: buffer.byteLength > limit,
      binary: !isText,
      language: LANGUAGE[ext] ?? (ext ? ext.slice(1) : 'text')
    }
  }

  search(workspaceId: string, query: string): FileHit[] {
    const trimmed = query.trim()
    if (!trimmed) throw new AppError('VALIDATION', 'Enter something to search for.')
    if (trimmed.length > 200) throw new AppError('VALIDATION', 'Search text is too long.')
    const { boundary } = this.boundary(workspaceId)
    const needle = trimmed.toLowerCase()
    const hits: FileHit[] = []
    let scanned = 0

    const walk = (absolute: string, depth: number): void => {
      if (hits.length >= 100 || scanned >= 1500 || depth > 8) return
      let dirents
      try {
        dirents = readdirSync(absolute, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of dirents) {
        if (hits.length >= 100 || scanned >= 1500) return
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          walk(join(absolute, entry.name), depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        const ext = extname(entry.name).toLowerCase()
        if (!TEXT_EXTENSIONS.has(ext) && !entry.name.startsWith('.')) continue
        const absoluteFile = join(absolute, entry.name)
        try {
          const stat = statSync(absoluteFile)
          if (stat.size > 512_000) continue
          const content = readFileSync(absoluteFile, 'utf8')
          if (content.includes('\0')) continue
          scanned += 1
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i] ?? ''
            if (line.toLowerCase().includes(needle)) {
              hits.push({
                path: relative(boundary.root, absoluteFile).split('\\').join('/'),
                line: i + 1,
                preview: line.trim().slice(0, 240)
              })
              if (hits.length >= 100) return
            }
          }
        } catch {
          // Skip unreadable files.
        }
      }
    }
    walk(boundary.root, 0)
    return hits
  }

  write(workspaceId: string, relativePath: string, content: string): FileWriteResult {
    if (content.length > 5_000_000) {
      throw new AppError('FILESYSTEM', 'Edits are limited to 5 MB.')
    }
    const { workspace, boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath, { allowMissing: true })
    const cleanRelative = assertSafeRelativePath(relativePath)
    if (cleanRelative === '' || cleanRelative === '.') {
      throw new AppError('VALIDATION', 'A file path is required.')
    }
    const parent = dirname(absolute)
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new AppError('FILESYSTEM', 'The destination folder does not exist.')
    }
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      throw new AppError('VALIDATION', 'That path is a folder.')
    }

    let backupPath: string | null = null
    if (existsSync(absolute)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeRelative = cleanRelative.split('/').join('__')
      const backupDir = join(this.backupRoot, workspace.id, stamp)
      mkdirSync(backupDir, { recursive: true })
      backupPath = join(backupDir, `${safeRelative}.bak`)
      copyFileSync(absolute, backupPath)
    }

    const temp = `${absolute}.igris-tmp-${Date.now()}`
    try {
      writeFileSync(temp, content, 'utf8')
      try {
        renameSync(temp, absolute)
      } catch {
        writeFileSync(absolute, content, 'utf8')
        try {
          rmSync(temp, { force: true })
        } catch {
          // Ignore temp cleanup failures.
        }
      }
    } catch (error) {
      try {
        rmSync(temp, { force: true })
      } catch {
        // Ignore.
      }
      throw new AppError('FILESYSTEM', 'The file could not be written. It may be locked or read-only.', {
        cause: error
      })
    }

    return {
      path: cleanRelative,
      bytes: Buffer.byteLength(content, 'utf8'),
      backupPath
    }
  }

  create(workspaceId: string, relativePath: string, type: 'file' | 'dir'): void {
    const { boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath, { allowMissing: true })
    const cleanRelative = assertSafeRelativePath(relativePath)
    if (cleanRelative === '' || cleanRelative === '.') {
      throw new AppError('VALIDATION', 'Enter a name for the new item.')
    }
    if (existsSync(absolute)) {
      throw new AppError('FILESYSTEM', 'An item with that name already exists.')
    }
    const parent = dirname(absolute)
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new AppError('FILESYSTEM', 'The destination folder does not exist.')
    }
    if (type === 'dir') {
      mkdirSync(absolute)
    } else {
      writeFileSync(absolute, '', { encoding: 'utf8', flag: 'wx' })
    }
  }

  rename(workspaceId: string, from: string, to: string): void {
    const { boundary } = this.boundary(workspaceId)
    const source = boundary.resolve(from)
    const target = boundary.resolve(to, { allowMissing: true })
    if (source === boundary.root) throw new AppError('PERMISSION', 'The workspace root cannot be moved.')
    if (existsSync(target)) throw new AppError('FILESYSTEM', 'The destination already exists.')
    const parent = dirname(target)
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      throw new AppError('FILESYSTEM', 'The destination folder does not exist.')
    }
    renameSync(source, target)
  }

  async delete(workspaceId: string, relativePath: string): Promise<void> {
    const { boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath)
    if (absolute === boundary.root) {
      throw new AppError('PERMISSION', 'The workspace root cannot be deleted from IGRIS.')
    }
    const { shell } = await import('electron')
    try {
      await shell.trashItem(absolute)
    } catch (error) {
      throw new AppError(
        'FILESYSTEM',
        'Windows could not move that item to the Recycle Bin. Close any app using it and try again.',
        { cause: error }
      )
    }
  }

  async reveal(workspaceId: string, relativePath: string): Promise<void> {
    const { boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath)
    const { shell } = await import('electron')
    shell.showItemInFolder(absolute)
  }

  readAbsolute(workspaceId: string, relativePath: string): string {
    const { boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath)
    return readFileSync(absolute, 'utf8')
  }

  exists(workspaceId: string, relativePath: string): boolean {
    try {
      const { boundary } = this.boundary(workspaceId)
      return existsSync(boundary.resolve(relativePath))
    } catch {
      return false
    }
  }

  backupFile(workspaceId: string, relativePath: string): string {
    const { workspace, boundary } = this.boundary(workspaceId)
    const absolute = boundary.resolve(relativePath)
    if (!lstatSync(absolute).isFile()) throw new AppError('VALIDATION', 'Only files can be checkpointed.')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(this.backupRoot, workspace.id, `checkpoint-${stamp}`)
    mkdirSync(backupDir, { recursive: true })
    const clean = assertSafeRelativePath(relativePath)
    const target = joinInside(backupDir, clean)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(absolute, target)
    return target
  }
}

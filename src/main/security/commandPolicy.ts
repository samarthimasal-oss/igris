import { basename } from 'node:path'
import { AppError } from './errors'

export interface CommandEvaluation {
  executable: string
  args: string[]
  display: string
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
}

const ALLOWED: Record<string, { risk: 'low' | 'medium' | 'high'; label: string }> = {
  node: { risk: 'medium', label: 'Node.js' },
  npm: { risk: 'medium', label: 'npm' },
  pnpm: { risk: 'medium', label: 'pnpm' },
  yarn: { risk: 'medium', label: 'Yarn' },
  npx: { risk: 'high', label: 'npx (may download packages)' },
  git: { risk: 'medium', label: 'Git' },
  tsc: { risk: 'low', label: 'TypeScript compiler' },
  vite: { risk: 'low', label: 'Vite' },
  vitest: { risk: 'low', label: 'Vitest' },
  jest: { risk: 'low', label: 'Jest' },
  eslint: { risk: 'low', label: 'ESLint' },
  prettier: { risk: 'low', label: 'Prettier' },
  cargo: { risk: 'medium', label: 'Cargo' },
  rustc: { risk: 'low', label: 'rustc' },
  python: { risk: 'medium', label: 'Python' },
  python3: { risk: 'medium', label: 'Python' },
  py: { risk: 'medium', label: 'Python launcher' },
  pip: { risk: 'high', label: 'pip (installs packages)' },
  pytest: { risk: 'low', label: 'pytest' },
  dotnet: { risk: 'medium', label: '.NET CLI' },
  go: { risk: 'medium', label: 'Go' },
  javac: { risk: 'low', label: 'Java compiler' },
  java: { risk: 'medium', label: 'Java' },
  mvn: { risk: 'medium', label: 'Maven' },
  gradle: { risk: 'medium', label: 'Gradle' },
  make: { risk: 'medium', label: 'Make' },
  cmake: { risk: 'medium', label: 'CMake' },
  bun: { risk: 'medium', label: 'Bun' }
}

const SHELL_META = /[;&|<>`$^%!\n\r]/
const FORBIDDEN_GIT = [
  { pattern: /^push$/i, reason: 'Git push is blocked. Push from your own terminal after reviewing changes.' },
  { pattern: /^reset$/i, args: /--hard/i, reason: 'git reset --hard can destroy uncommitted work.' },
  { pattern: /^clean$/i, args: /-[a-z]*f/i, reason: 'git clean -f can delete untracked files.' },
  { pattern: /^filter-branch$/i, reason: 'git filter-branch rewrites repository history.' },
  { pattern: /^reflog$/i, args: /expire/i, reason: 'Reflog expiry removes recovery points.' }
]

export function tokenizeCommand(command: string): string[] {
  if (typeof command !== 'string') throw new AppError('VALIDATION', 'A command is required.')
  const trimmed = command.trim()
  if (!trimmed) throw new AppError('VALIDATION', 'Enter a command to run.')
  if (trimmed.length > 2000) throw new AppError('VALIDATION', 'That command is too long.')
  if (SHELL_META.test(trimmed)) {
    throw new AppError(
      'VALIDATION',
      'Shell operators and expansion characters are not supported. Run one plain command at a time.'
    )
  }

  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hadQuote = false

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i]
    if (quote) {
      if (char === quote) {
        quote = null
        hadQuote = true
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      hadQuote = true
    } else if (/\s/.test(char)) {
      if (current || hadQuote) {
        tokens.push(current)
        current = ''
        hadQuote = false
      }
    } else {
      current += char
    }
  }
  if (quote) throw new AppError('VALIDATION', 'The command has an unclosed quote.')
  if (current || hadQuote) tokens.push(current)
  if (!tokens.length) throw new AppError('VALIDATION', 'Enter a command to run.')
  if (tokens.length > 100) throw new AppError('VALIDATION', 'That command has too many arguments.')
  return tokens
}

export function evaluateCommand(command: string): CommandEvaluation {
  const tokens = tokenizeCommand(command)
  const rawExecutable = tokens[0] ?? ''
  const base = basename(rawExecutable).replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase()
  const allowed = ALLOWED[base]
  if (!allowed) {
    throw new AppError(
      'UNSUPPORTED',
      `"${base}" is not in the terminal allowlist. Supported tools include npm, node, git, tsc, cargo, python, dotnet and common test runners.`
    )
  }

  const args = tokens.slice(1)
  const reasons: string[] = [allowed.label]
  let risk: 'low' | 'medium' | 'high' = allowed.risk

  if (base === 'git') {
    const sub = (args[0] ?? '').toLowerCase()
    for (const rule of FORBIDDEN_GIT) {
      if (rule.pattern.test(sub) && (!rule.args || args.some((arg) => rule.args?.test(arg)))) {
        throw new AppError('PERMISSION', rule.reason)
      }
    }
    if (['push', 'commit', 'merge', 'rebase', 'checkout', 'switch'].includes(sub)) {
      risk = 'high'
      reasons.push('changes git state')
    }
  }

  if (['npm', 'pnpm', 'yarn', 'bun'].includes(base)) {
    const sub = (args[0] ?? '').toLowerCase()
    if (['publish', 'login', 'adduser', 'token', 'logout'].includes(sub)) {
      throw new AppError('PERMISSION', 'Package publishing and credential commands are blocked.')
    }
    if (sub === 'install' || sub === 'i' || sub === 'add' || sub === 'ci') {
      risk = 'high'
      reasons.push('installs dependencies and runs package lifecycle scripts')
    }
  }

  if (base === 'npx') {
    risk = 'high'
    reasons.push('may download and execute a package')
  }

  if (base === 'pip' && ['install', 'uninstall'].includes((args[0] ?? '').toLowerCase())) {
    risk = 'high'
    reasons.push('modifies the Python environment')
  }

  return {
    executable: base,
    args,
    display: [base, ...args].join(' '),
    risk,
    reasons
  }
}

export const TERMINAL_ALLOWLIST = Object.keys(ALLOWED)

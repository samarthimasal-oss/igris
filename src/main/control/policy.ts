import { AppError } from '../security/errors'

export interface WindowSafetyInput {
  pid: number
  process: string
  title?: string
  elevated?: boolean
}

export interface SelfIdentity {
  pid: number
  processName: string
}

const SECURE_PROCESSES = new Set(['consent', 'logonui', 'winlogon', 'credentialuibroker'])
const CREDENTIAL_PROCESSES = new Set([
  '1password',
  'bitwarden',
  'dashlane',
  'enpass',
  'keepass',
  'keepassxc',
  'keeper',
  'lastpass',
  'nordpass',
  'roboform'
])
const SHELL_PROCESSES = new Set([
  'bash',
  'cmd',
  'conhost',
  'mintty',
  'powershell',
  'pwsh',
  'windowsterminal',
  'wt',
  'wsl',
  'wslhost'
])

const NAMED_KEYS = new Set([
  'backspace',
  'back',
  'tab',
  'enter',
  'return',
  'shift',
  'control',
  'ctrl',
  'alt',
  'menu',
  'pause',
  'capslock',
  'esc',
  'escape',
  'space',
  'pageup',
  'pagedown',
  'end',
  'home',
  'left',
  'up',
  'right',
  'down',
  'printscreen',
  'insert',
  'delete',
  'del',
  'win',
  'windows',
  'lwin',
  'apps',
  'multiply',
  'add',
  'subtract',
  'decimal',
  'divide',
  'numlock',
  'scrolllock',
  'lshift',
  'rshift',
  'lcontrol',
  'rcontrol',
  'lalt',
  'ralt',
  'volume_mute',
  'volume_down',
  'volume_up',
  'media_next',
  'media_prev',
  'media_stop',
  'media_play'
])

function normalizeKeyToken(token: string): string {
  const key = token.trim()
  if (!key) return ''
  const lower = key.toLowerCase()
  if (lower === 'ctrl') return 'Ctrl'
  if (lower === 'control') return 'Control'
  if (lower === 'alt') return 'Alt'
  if (lower === 'shift') return 'Shift'
  if (lower === 'esc') return 'Esc'
  if (lower === 'escape') return 'Escape'
  if (lower === 'enter') return 'Enter'
  if (lower === 'return') return 'Return'
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase()
  if (key.length === 1) return key
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function isKnownKey(token: string): boolean {
  const lower = token.toLowerCase()
  if (NAMED_KEYS.has(lower)) return true
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return true
  return token.length === 1
}

export function parseKeyChord(input: string): string[] {
  const tokens = input
    .split('+')
    .map(normalizeKeyToken)
    .filter(Boolean)
  if (!input.trim() || tokens.length === 0) {
    throw new AppError('VALIDATION', 'A key or key chord is required, for example "Enter" or "Ctrl+S".')
  }
  if (input.trim().endsWith('+') || tokens.length !== input.split('+').length) {
    throw new AppError('VALIDATION', 'The key chord is incomplete. Use a form like "Ctrl+Shift+S".')
  }
  const unknown = tokens.filter((token) => !isKnownKey(token))
  if (unknown.length) {
    throw new AppError(
      'VALIDATION',
      `Unknown key name${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`
    )
  }
  return tokens
}

export function isCloseChord(keys: string[]): boolean {
  const lowered = keys.map((key) => key.toLowerCase())
  return lowered.includes('alt') && lowered.includes('f4')
}

export function windowBlockReason(window: WindowSafetyInput, self: SelfIdentity): string | null {
  const process = window.process.toLowerCase()
  const selfName = self.processName.toLowerCase()
  if (window.pid === self.pid || process === selfName || process === 'igris') {
    return 'IGRIS does not control its own windows.'
  }
  if (SECURE_PROCESSES.has(process)) {
    return 'Windows blocks automation on the secure desktop, UAC prompts, and the sign-in screen.'
  }
  if (CREDENTIAL_PROCESSES.has(process)) {
    return `IGRIS never operates credential managers (${window.process}). Ask the user to use it directly.`
  }
  if (window.elevated) {
    return 'Windows blocks input to elevated windows. IGRIS runs unelevated and cannot automate this window.'
  }
  return null
}

export function isShellProcess(process: string): boolean {
  return SHELL_PROCESSES.has(process.toLowerCase())
}

export function validateBrowserUrl(input: string): URL {
  const raw = input.trim()
  if (raw.length === 0) throw new AppError('VALIDATION', 'A web address is required.')
  if (raw.length > 2048) throw new AppError('VALIDATION', 'That web address is too long.')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AppError('VALIDATION', 'Enter a complete web address, for example https://example.com.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('PERMISSION', 'The managed browser only opens HTTP and HTTPS addresses.')
  }
  if (url.username || url.password) {
    throw new AppError('PERMISSION', 'Web addresses containing credentials are not allowed.')
  }
  return url
}

const SENSITIVE_PATTERNS = [
  /\bplace\s+order\b/i,
  /\bbuy\s+now\b/i,
  /\bconfirm\s+(payment|purchase|order)\b/i,
  /\bpay\s+now\b/i,
  /\bcomplete\s+(checkout|purchase|payment)\b/i,
  /\bcheckout\b/i,
  /\bpurchase\b/i,
  /\btransfer\s+funds\b/i,
  /\bsend\s+(message|email|payment|money|now)\b/i,
  /\bdelete\s+(account|everything|all)\b/i,
  /\bformat\s+(disk|drive)\b/i
]

export function isSensitiveText(text: string): boolean {
  if (!text.trim()) return false
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))
}

/** Cut long text for tool results without splitting surrogate pairs. */
export function clipText(text: string, limit: number): string {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  let cut = value.slice(0, limit)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut}\n[truncated]`
}

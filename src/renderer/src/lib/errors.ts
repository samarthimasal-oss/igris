export interface BridgeFailure extends Error {
  code?: string
  retryable?: boolean
}

export function errorMessage(error: unknown, fallback = 'The action could not be completed.'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

export function errorHint(error: unknown): string | null {
  const code = errorCode(error)
  switch (code) {
    case 'AUTH':
      return 'Check the API key in AI Models.'
    case 'CONFIG':
      return 'A provider or model still needs to be configured.'
    case 'PERMISSION':
      return 'Enable the required capability in Settings → Permissions.'
    case 'NETWORK':
      return 'Check your internet connection, then try again.'
    case 'RATE_LIMIT':
      return 'The provider is throttling requests. Wait a moment.'
    case 'TIMEOUT':
      return 'The provider took too long to respond.'
    case 'QUOTA':
      return 'The provider account has no remaining quota.'
    default:
      return null
  }
}

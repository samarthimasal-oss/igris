export type ErrorCode =
  | 'CONFIG'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'QUOTA'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'PROVIDER'
  | 'VALIDATION'
  | 'PERMISSION'
  | 'NOT_FOUND'
  | 'FILESYSTEM'
  | 'TERMINAL'
  | 'BROWSER'
  | 'CANCELLED'
  | 'UNSUPPORTED'
  | 'INTERNAL'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly userMessage: string

  constructor(
    code: ErrorCode,
    userMessage: string,
    options: { retryable?: boolean; cause?: unknown; internal?: string } = {}
  ) {
    super(options.internal ?? userMessage, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.retryable = options.retryable ?? ['NETWORK', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER'].includes(code)
    this.userMessage = userMessage
  }
}

export function normalizeError(error: unknown, fallback = 'Something went wrong.'): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new AppError('CANCELLED', 'The operation was cancelled.')
    }
    const message = error.message || fallback
    return new AppError('INTERNAL', fallback, { internal: message, cause: error })
  }
  return new AppError('INTERNAL', fallback, { internal: String(error) })
}

export function serializeError(error: unknown, fallback?: string): { code: string; message: string; retryable: boolean } {
  const appError = normalizeError(error, fallback)
  return {
    code: appError.code,
    message: appError.userMessage,
    retryable: appError.retryable
  }
}

export function httpStatusToError(status: number, body: string): AppError {
  const clean = body.slice(0, 1200)
  if (status === 401 || status === 403) {
    return new AppError('AUTH', 'The provider rejected this credential. Check the API key and permissions.', {
      internal: `HTTP ${status}: ${clean}`
    })
  }
  if (status === 404) {
    return new AppError('PROVIDER', 'The provider did not recognize this endpoint or model.', {
      internal: `HTTP 404: ${clean}`
    })
  }
  if (status === 429) {
    return new AppError('RATE_LIMIT', 'The provider rate limit was reached. Wait a moment and retry.', {
      retryable: true,
      internal: `HTTP 429: ${clean}`
    })
  }
  if (status === 402) {
    return new AppError('QUOTA', 'The provider reports insufficient credits or quota for this request.', {
      internal: `HTTP 402: ${clean}`
    })
  }
  if (status >= 500) {
    return new AppError('PROVIDER', 'The provider had a server-side failure. Try again shortly.', {
      retryable: true,
      internal: `HTTP ${status}: ${clean}`
    })
  }
  return new AppError('PROVIDER', `The provider returned an error (HTTP ${status}).`, {
    internal: clean
  })
}

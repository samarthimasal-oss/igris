import { AppError, httpStatusToError } from '../security/errors'
import { readErrorBody } from './sse'

export async function httpRequest(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('CANCELLED', 'The request was cancelled.')
    }
    throw new AppError(
      'NETWORK',
      'IGRIS could not reach the provider. Check your internet connection and the base URL.',
      { cause: error }
    )
  }
}

export async function assertOk(response: Response): Promise<Response> {
  if (response.ok) return response
  const body = await readErrorBody(response)
  throw httpStatusToError(response.status, body)
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function validateBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError('VALIDATION', 'Enter a valid provider base URL.')
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new AppError('VALIDATION', 'Provider URLs must use HTTPS (or HTTP on localhost).')
  }
  if (
    url.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  ) {
    throw new AppError('VALIDATION', 'Plain HTTP is only allowed for local endpoints.')
  }
  if (url.username || url.password) {
    throw new AppError('VALIDATION', 'Do not embed credentials in the URL.')
  }
  return normalizeBaseUrl(url.toString())
}

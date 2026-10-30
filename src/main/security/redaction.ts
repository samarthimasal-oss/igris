const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, '[redacted-anthropic-key]'],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[redacted-openai-key]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted-google-key]'],
  [/\bAQ\.[A-Za-z0-9_-]{20,}\b/g, '[redacted-google-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted-github-token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted-slack-token]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]'],
  [/((?:"|')?(?:api[-_]?key|apikey|token|secret|password)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]'],
  [/([?&](?:key|api_key|access_token|token)=)[^&\s]+/gi, '$1[redacted]']
]

/** Best-effort redaction for logs, tool output and diagnostics. */
export function redactSecrets(input: string): string {
  let output = input
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n… (${value.length - max} characters omitted)`
}

export function redactAndTruncate(value: string, max: number): string {
  return truncate(redactSecrets(value), max)
}

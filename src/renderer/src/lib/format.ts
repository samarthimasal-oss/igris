import { PROVIDER_CATALOG } from '@shared/defaults'
import type { ProviderKind, TaskStatus, ToolExecutionRecord } from '@shared/types'

export function relativeTime(value: string | null | undefined): string {
  if (!value) return 'never'
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(diff)) return 'unknown'
  const seconds = Math.round(diff / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fullTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function clockTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function duration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function uptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function providerLabel(kind: ProviderKind): string {
  return PROVIDER_CATALOG[kind]?.label ?? kind
}

export function taskStatusLabel(status: TaskStatus | ToolExecutionRecord['status']): string {
  return status.replace(/_/g, ' ')
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still awake'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}

export function languageLabel(path: string): string {
  const ext = extensionOf(path)
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    json: 'JSON',
    md: 'Markdown',
    css: 'CSS',
    html: 'HTML',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
    sh: 'Shell',
    ps1: 'PowerShell',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML'
  }
  return map[ext] ?? (ext ? ext.toUpperCase() : 'Text')
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`
}

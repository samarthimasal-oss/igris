import type {
  ConversationSummary,
  MemoryItem,
  ToolEventPayload,
  Workspace
} from '@shared/types'
import type { ActiveRun } from './store'

export type TerminalTone = 'info' | 'success' | 'warning' | 'danger' | 'muted'

export interface TerminalLine {
  text: string
  tone?: TerminalTone
}

export interface RunSnapshot {
  runId: string
  conversationId: string
  userText: string
  text: string
  status: ActiveRun['status']
  detail: string | null
  providerName: string
  model: string
  tools: ToolEventPayload[]
  error: string | null
  code: string | null
  startedAt: number
  finished: boolean
}

export interface CapabilitySummary {
  key: string
  label: string
  permission: string | null
  permissionOn: boolean
  tools: number
  ready: number
}

export type TerminalBlock =
  | {
      id: string
      type: 'command'
      text: string
      at: number
      source: 'user' | 'system'
    }
  | { id: string; type: 'lines'; lines: TerminalLine[] }
  | {
      id: string
      type: 'run'
      runId: string
      userText: string
      at: number
      snapshot: RunSnapshot | null
    }
  | { id: string; type: 'history'; items: ConversationSummary[] }
  | { id: string; type: 'memory'; items: MemoryItem[] }
  | { id: string; type: 'projects'; items: Workspace[] }
  | { id: string; type: 'tools'; groups: CapabilitySummary[]; total: number; ready: number }

export interface TerminalCommandInfo {
  name: string
  description: string
}

export const TERMINAL_COMMANDS: TerminalCommandInfo[] = [
  { name: '/help', description: 'List available terminal commands.' },
  { name: '/status', description: 'Provider, permissions, tools, projects and local health.' },
  { name: '/projects', description: 'List approved project folders.' },
  { name: '/tools', description: 'Show capability groups and permission state.' },
  { name: '/history', description: 'Browse local conversation history.' },
  { name: '/memory', description: 'Read and forget saved memories.' },
  { name: '/settings', description: 'Open Settings.' },
  { name: '/clear', description: 'Clear this terminal and start a new context.' }
]

export function snapshotRun(run: ActiveRun): RunSnapshot {
  return {
    runId: run.runId,
    conversationId: run.conversationId,
    userText: run.userText,
    text: run.text,
    status: run.status,
    detail: run.detail,
    providerName: run.providerName,
    model: run.model,
    tools: run.tools,
    error: run.error,
    code: run.code,
    startedAt: run.startedAt,
    finished: run.finished
  }
}

const TONE_PREFIX: Record<TerminalTone, string> = {
  info: '::',
  success: 'ok',
  warning: '!!',
  danger: 'xx',
  muted: '--'
}

export function tonePrefix(tone: TerminalTone = 'info'): string {
  return TONE_PREFIX[tone]
}

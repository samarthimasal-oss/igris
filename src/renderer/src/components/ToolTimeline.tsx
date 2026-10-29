import { useState } from 'react'
import {
  Ban,
  Check,
  ChevronDown,
  Clock3,
  Loader2,
  ShieldAlert,
  X
} from 'lucide-react'
import type { ToolEventPayload, ToolExecutionRecord } from '@shared/types'
import clsx from 'clsx'

type ToolStatus = ToolExecutionRecord['status']

export interface TimelineItem {
  key: string
  title: string
  status: ToolStatus
  arguments?: Record<string, unknown>
  result?: string
  error?: string
}

export function fromToolEvents(events: ToolEventPayload[]): TimelineItem[] {
  return events.map((event) => ({
    key: event.callId,
    title: event.title || event.toolName,
    status: event.status,
    arguments: event.arguments,
    result: event.result,
    error: event.error
  }))
}

export function fromToolRecords(records: ToolExecutionRecord[]): TimelineItem[] {
  return records.map((record) => ({
    key: record.id,
    title: record.name,
    status: record.status,
    arguments: record.arguments,
    result: record.result,
    error: record.error
  }))
}

function statusMeta(status: ToolStatus): {
  label: string
  tone: string
  icon: typeof Check
} {
  switch (status) {
    case 'requested':
      return { label: 'Requested', tone: 'neutral', icon: Clock3 }
    case 'awaiting_confirmation':
      return { label: 'Approval needed', tone: 'warning', icon: ShieldAlert }
    case 'running':
      return { label: 'Running', tone: 'accent', icon: Loader2 }
    case 'completed':
      return { label: 'Completed', tone: 'success', icon: Check }
    case 'failed':
      return { label: 'Failed', tone: 'danger', icon: X }
    case 'denied':
      return { label: 'Denied', tone: 'warning', icon: Ban }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral', icon: Ban }
    default:
      return { label: status, tone: 'neutral', icon: Clock3 }
  }
}

export function ToolTimeline({
  items,
  compact = false
}: {
  items: TimelineItem[]
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (!items.length) return null

  return (
    <div className={clsx('tool-timeline', compact && 'is-compact')}>
      {items.map((item) => {
        const meta = statusMeta(item.status)
        const Icon = meta.icon
        const open = Boolean(expanded[item.key])
        const hasDetail = Boolean(
          item.arguments && Object.keys(item.arguments).length > 0
        ) || Boolean(item.result) || Boolean(item.error)
        return (
          <div
            key={item.key}
            className={clsx('tool-row', `tone-${meta.tone}`, open && 'is-open')}
          >
            <button
              type="button"
              className="tool-row-main"
              onClick={() =>
                hasDetail
                  ? setExpanded((current) => ({ ...current, [item.key]: !current[item.key] }))
                  : undefined
              }
              aria-expanded={hasDetail ? open : undefined}
            >
              <span className="tool-status-icon">
                <Icon size={13} className={item.status === 'running' ? 'spin' : undefined} />
              </span>
              <span className="tool-title">{item.title}</span>
              <span className="tool-status-label">{meta.label}</span>
              {hasDetail ? (
                <ChevronDown size={13} className={clsx('tool-chevron', open && 'is-open')} />
              ) : null}
            </button>
            {open && hasDetail ? (
              <div className="tool-row-detail">
                {item.arguments && Object.keys(item.arguments).length ? (
                  <div className="tool-detail-block">
                    <span className="tool-detail-label">Arguments</span>
                    <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
                  </div>
                ) : null}
                {item.error ? (
                  <div className="tool-detail-block is-error">
                    <span className="tool-detail-label">Error</span>
                    <p>{item.error}</p>
                  </div>
                ) : null}
                {item.result ? (
                  <div className="tool-detail-block">
                    <span className="tool-detail-label">Result</span>
                    <pre>{item.result}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

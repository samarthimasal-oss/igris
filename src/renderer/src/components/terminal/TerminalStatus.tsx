import clsx from 'clsx'

export interface TerminalStatusItem {
  label: string
  value: string
  tone?: 'default' | 'live' | 'warn' | 'error' | 'dim'
}

export function TerminalStatus({
  items,
  hint
}: {
  items: TerminalStatusItem[]
  hint?: string
}) {
  return (
    <div className="tw-status">
      <div className="tw-status-items">
        {items.map((item) => (
          <span key={item.label} className={clsx('tw-status-item', `is-${item.tone ?? 'default'}`)}>
            <span className="tw-status-label">{item.label}</span>
            <span className="tw-status-value">{item.value}</span>
          </span>
        ))}
      </div>
      {hint ? <span className="tw-status-hint">{hint}</span> : null}
    </div>
  )
}

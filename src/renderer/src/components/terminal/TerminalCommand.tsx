import clsx from 'clsx'
import { TerminalPrompt } from './TerminalPrompt'

export function TerminalCommand({
  text,
  at,
  source = 'user'
}: {
  text: string
  at?: number
  source?: 'user' | 'system'
}) {
  const time = at
    ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <div className={clsx('tw-command', source === 'system' && 'is-system')}>
      {time ? <span className="tw-command-time">{time}</span> : null}
      <TerminalPrompt path={source === 'system' ? 'igris:core' : 'home'} symbol={source === 'system' ? '#' : '❯'}>
        <span className="tw-command-text">{text}</span>
      </TerminalPrompt>
    </div>
  )
}

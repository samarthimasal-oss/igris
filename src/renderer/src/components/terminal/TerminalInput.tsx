import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { CornerDownLeft, Mic, Square } from 'lucide-react'
import clsx from 'clsx'
import type { TerminalCommandInfo } from '../../lib/terminal'
import { TerminalPrompt } from './TerminalPrompt'

interface TerminalInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (command?: string) => void
  onCancel?: () => void
  busy?: boolean
  disabled?: boolean
  placeholder?: string
  commands: TerminalCommandInfo[]
  history: string[]
  voiceEnabled?: boolean
  onVoiceBlocked?: () => void
  onVoice?: (text: string) => void
  onError?: (title: string, message?: string) => void
}

export const TerminalInput = forwardRef<HTMLInputElement, TerminalInputProps>(
  function TerminalInput(
    {
      value,
      onChange,
      onSubmit,
      onCancel,
      busy = false,
      disabled = false,
      placeholder = 'Ask anything, or type /help',
      commands,
      history,
      voiceEnabled = false,
      onVoiceBlocked,
      onVoice,
      onError
    },
    ref
  ) {
    const historyIndex = useRef(-1)
    const [listening, setListening] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [seconds, setSeconds] = useState(0)
    const recorderRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const query = value.startsWith('/') && !value.includes(' ') ? value.toLowerCase() : null
    const hints = query
      ? commands.filter((command) => command.name.startsWith(query)).slice(0, 5)
      : []

    useEffect(() => {
      return () => {
        if (timerRef.current) clearInterval(timerRef.current)
        const recorder = recorderRef.current
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // Recorder may already be closed during teardown.
          }
        }
        streamRef.current?.getTracks().forEach((track) => track.stop())
      }
    }, [])

    const submit = (command?: string): void => {
      historyIndex.current = -1
      onSubmit(command)
    }

    const handleKey = (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        submit()
        return
      }
      if (event.key === 'Tab' && hints.length) {
        event.preventDefault()
        onChange(`${hints[0].name} `)
        return
      }
      if (event.key === 'Escape' && busy && onCancel) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key === 'ArrowUp' && history.length) {
        event.preventDefault()
        const next =
          historyIndex.current < 0
            ? history.length - 1
            : Math.max(0, historyIndex.current - 1)
        historyIndex.current = next
        onChange(history[next])
        return
      }
      if (event.key === 'ArrowDown' && historyIndex.current >= 0) {
        event.preventDefault()
        const next = historyIndex.current + 1
        if (next >= history.length) {
          historyIndex.current = -1
          onChange('')
        } else {
          historyIndex.current = next
          onChange(history[next])
        }
      }
    }

    const stopListening = (): void => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        setListening(false)
        return
      }
      setListening(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      try {
        recorder.stop()
      } catch {
        // Already stopped.
      }
    }

    const startListening = async (): Promise<void> => {
      if (listening || busy || transcribing) return
      if (!voiceEnabled) {
        onVoiceBlocked?.()
        return
      }
      const bridge = window.igris
      if (!bridge) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const preferred = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
        const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
        recorderRef.current = recorder
        streamRef.current = stream
        chunksRef.current = []
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.onstop = async (): Promise<void> => {
          recorderRef.current = null
          setListening(false)
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          stream.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          if (!blob.size) return
          setTranscribing(true)
          try {
            const audioBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
              reader.onerror = () => reject(reader.error)
              reader.readAsDataURL(blob)
            })
            const rawMime = (blob.type || 'audio/webm').split(';')[0]
            const allowed = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
            const mimeType = allowed.includes(rawMime) ? rawMime : 'audio/webm'
            const result = await bridge.voice.transcribe({ audioBase64, mimeType })
            const clean = result.text.trim()
            if (clean) onVoice?.(clean)
            else onError?.('Nothing transcribed', 'IGRIS could not hear any words. Try again.')
          } catch (error) {
            onError?.(
              'Voice transcription failed',
              error instanceof Error ? error.message : undefined
            )
          } finally {
            setTranscribing(false)
          }
        }
        recorder.start(250)
        setListening(true)
        setSeconds(0)
        timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000)
      } catch (error) {
        onError?.('Microphone access failed', error instanceof Error ? error.message : undefined)
      }
    }

    return (
      <div className={clsx('tw-input-wrap', busy && 'is-busy')}>
        {hints.length ? (
          <div className="tw-input-hints">
            {hints.map((command) => (
              <button
                key={command.name}
                type="button"
                className="tw-input-hint"
                onMouseDown={(event) => {
                  event.preventDefault()
                  onChange(`${command.name} `)
                  submit(command.name)
                }}
              >
                <span>{command.name}</span>
                <em>{command.description}</em>
              </button>
            ))}
          </div>
        ) : null}
        <div className="tw-input-row">
          <TerminalPrompt path="home" symbol="❯" className="tw-input-prompt" />
          <input
            ref={ref}
            className="tw-input"
            value={value}
            onChange={(event) => {
              historyIndex.current = -1
              onChange(event.target.value)
            }}
            onKeyDown={handleKey}
            placeholder={placeholder}
            aria-label="IGRIS terminal command"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
          {listening ? (
            <button
              type="button"
              className="tw-input-button is-recording"
              onClick={stopListening}
              title={`Stop recording (${seconds}s)`}
              aria-label="Stop voice input"
            >
              <span className="tw-record-time">{seconds}s</span>
              <Square size={12} />
            </button>
          ) : (
            <button
              type="button"
              className={clsx('tw-input-button', voiceEnabled ? 'is-voice' : 'is-muted')}
              onClick={() => void startListening()}
              title={voiceEnabled ? 'Voice input' : 'Enable voice in Settings'}
              aria-label="Voice input"
              disabled={busy || transcribing}
            >
              <Mic size={14} />
            </button>
          )}
          {busy ? (
            <button
              type="button"
              className="tw-input-button is-stop"
              onClick={onCancel}
              title="Stop the current response (Esc)"
              aria-label="Stop response"
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="tw-input-button is-submit"
              onClick={() => submit()}
              disabled={!value.trim()}
              title="Run (Enter)"
              aria-label="Run command"
            >
              <CornerDownLeft size={14} />
            </button>
          )}
        </div>
        <div className="tw-input-meta">
          <span>
            {transcribing
              ? 'transcribing voice…'
              : busy
                ? 'response in progress · esc to stop'
                : 'enter to run · ↑ history · tab completes'}
          </span>
          <span className="tw-input-mode">
            <i className={clsx('status-led', busy ? 'is-warn' : 'is-live')} />
            {busy ? 'busy' : 'ready'}
          </span>
        </div>
      </div>
    )
  }
)

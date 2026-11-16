/**
 * Renderer-side voice output and voice-activity helpers.
 * Speech uses the browser SpeechSynthesis API (Windows voices) — no paid API.
 * The pure helpers are unit-tested; the DOM functions guard availability.
 */

const MAX_SPEECH_LENGTH = 1200

/** Reduces an assistant message to the prose that should be spoken aloud. */
export function speechScript(markdown: string): string {
  return (
    markdown
      // Code blocks and inline code are for the eyes, not the ears.
      .replace(/```[\s\S]*?(?:```|$)/g, ' ')
      .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      // Images vanish; links keep their label but lose the URL.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Table rows become plain cell text without the pipe syntax;
      // separator rows (| --- | --- |) vanish entirely.
      .replace(/^\s*\|[\s:|-]+\|\s*$/gm, ' ')
      .replace(/^\s*\|.*$/gm, (row) => row.replace(/\|/g, ' ').trim())
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** RMS voice-activity check for one analysis window (amplitude 0..1). */
export function hasVoiceActivity(sample: Float32Array, threshold = 0.012): boolean {
  if (sample.length === 0) return false
  let sum = 0
  for (let index = 0; index < sample.length; index += 1) {
    const value = sample[index] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum / sample.length) >= threshold
}

export function speechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return []
  return window.speechSynthesis.getVoices()
}

export function isSpeaking(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false
  return window.speechSynthesis.speaking
}

/** Cancels any speech currently in progress. */
export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
}

/** Speaks assistant prose; cancels whatever is currently being spoken. */
export function speak(text: string, options: { voice?: string; rate?: number } = {}): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const script = speechScript(text)
  if (!script) return
  const cut =
    script.length > MAX_SPEECH_LENGTH
      ? // Truncate at the last sentence boundary within the limit.
        script.slice(0, MAX_SPEECH_LENGTH).replace(/[^.!?]+$/, '') || script.slice(0, MAX_SPEECH_LENGTH)
      : script
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(cut)
  const voice = options.voice
    ? window.speechSynthesis.getVoices().find((entry) => entry.name === options.voice)
    : undefined
  if (voice) utterance.voice = voice
  utterance.rate = Math.min(2, Math.max(0.5, options.rate ?? 1))
  window.speechSynthesis.speak(utterance)
}

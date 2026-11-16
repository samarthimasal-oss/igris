import { describe, expect, it } from 'vitest'
import { hasVoiceActivity, speechScript } from '../../src/shared/speech'

describe('speechScript', () => {
  it('removes fenced code blocks but keeps inline code words', () => {
    const script = speechScript('Here you go:\n```js\nconst x = 1\n```\nUse `npm test` to verify.')
    expect(script).toBe('Here you go: Use npm test to verify.')
  })

  it('removes an unclosed code fence entirely', () => {
    expect(speechScript('Result:\n```\nrun this')).toBe('Result:')
  })

  it('keeps link labels and drops URLs and images', () => {
    expect(speechScript('See [the docs](https://example.com) and ![logo](logo.png).')).toBe(
      'See the docs and.'
    )
  })

  it('strips markdown markers and collapses whitespace', () => {
    const script = speechScript('# Title\n- item one\n- item two\n**bold** and *soft*\n> quoted')
    expect(script).toBe('Title item one item two bold and soft quoted')
  })

  it('turns table rows into plain words', () => {
    expect(speechScript('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('a b 1 2')
  })

  it('returns empty text for a code-only message', () => {
    expect(speechScript('```\nselect * from t\n```')).toBe('')
  })
})

describe('hasVoiceActivity', () => {
  const sine = (amplitude: number, length = 2048): Float32Array => {
    const buffer = new Float32Array(length)
    for (let index = 0; index < length; index += 1) {
      buffer[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / 48000)
    }
    return buffer
  }

  it('accepts speech-level amplitude', () => {
    expect(hasVoiceActivity(sine(0.2))).toBe(true)
  })

  it('accepts quiet speech just above the threshold', () => {
    expect(hasVoiceActivity(sine(0.02))).toBe(true)
  })

  it('rejects silence and near-silence', () => {
    expect(hasVoiceActivity(new Float32Array(2048))).toBe(false)
    expect(hasVoiceActivity(sine(0.001))).toBe(false)
  })

  it('rejects an empty buffer', () => {
    expect(hasVoiceActivity(new Float32Array(0))).toBe(false)
  })
})

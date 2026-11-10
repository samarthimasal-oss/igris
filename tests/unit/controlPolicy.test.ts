import { describe, expect, it } from 'vitest'
import {
  isCloseChord,
  isSensitiveText,
  isShellProcess,
  parseKeyChord,
  validateBrowserUrl,
  windowBlockReason
} from '../../src/main/control/policy'

const self = { pid: 100, processName: 'IGRIS' }

function window(overrides: Partial<Parameters<typeof windowBlockReason>[0]> = {}) {
  return {
    pid: 200,
    process: 'notepad',
    title: 'Untitled - Notepad',
    elevated: false,
    ...overrides
  }
}

describe('parseKeyChord', () => {
  it('splits modifiers and normalizes names', () => {
    expect(parseKeyChord('Ctrl+Shift+S')).toEqual(['Ctrl', 'Shift', 'S'])
    expect(parseKeyChord('alt+f4')).toEqual(['Alt', 'F4'])
    expect(parseKeyChord('control+enter')).toEqual(['Control', 'Enter'])
  })

  it('rejects empty chords', () => {
    expect(() => parseKeyChord('   ')).toThrow(/key/i)
    expect(() => parseKeyChord('Ctrl+')).toThrow(/key/i)
  })
})

describe('isCloseChord', () => {
  it('recognizes Alt+F4 regardless of case or order', () => {
    expect(isCloseChord(['Alt', 'F4'])).toBe(true)
    expect(isCloseChord(['f4', 'alt'])).toBe(true)
    expect(isCloseChord(['Ctrl', 'W'])).toBe(false)
  })
})

describe('windowBlockReason', () => {
  it('allows ordinary app windows', () => {
    expect(windowBlockReason(window(), self)).toBeNull()
  })

  it('blocks elevated windows', () => {
    expect(windowBlockReason(window({ elevated: true }), self)).toMatch(/elevated/i)
  })

  it('blocks UAC and secure desktop processes', () => {
    expect(windowBlockReason(window({ process: 'consent' }), self)).toMatch(/secure|elevated/i)
    expect(windowBlockReason(window({ process: 'LogonUI' }), self)).toMatch(/secure|elevated/i)
    expect(windowBlockReason(window({ process: 'winlogon' }), self)).toMatch(/secure|elevated/i)
  })

  it('blocks credential managers', () => {
    for (const process of ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane']) {
      expect(windowBlockReason(window({ process }), self)).toMatch(/credential/i)
    }
  })

  it('blocks IGRIS itself', () => {
    expect(windowBlockReason(window({ pid: 100 }), self)).toMatch(/IGRIS/i)
    expect(windowBlockReason(window({ process: 'igris' }), self)).toMatch(/IGRIS/i)
  })
})

describe('isShellProcess', () => {
  it('recognizes terminals and shells', () => {
    for (const process of ['cmd', 'powershell', 'pwsh', 'WindowsTerminal', 'wt', 'bash', 'wsl']) {
      expect(isShellProcess(process)).toBe(true)
    }
    expect(isShellProcess('notepad')).toBe(false)
  })
})

describe('validateBrowserUrl', () => {
  it('accepts http and https', () => {
    expect(validateBrowserUrl('https://example.com/path?q=1').hostname).toBe('example.com')
    expect(validateBrowserUrl('http://localhost:3000').port).toBe('3000')
  })

  it('rejects unsafe schemes and credentials', () => {
    for (const url of [
      'file:///C:/Windows',
      'javascript:alert(1)',
      'data:text/html,hello',
      'chrome://settings',
      'https://user:secret@example.com',
      'not a url'
    ]) {
      expect(() => validateBrowserUrl(url)).toThrow()
    }
  })

  it('rejects absurdly long urls', () => {
    expect(() => validateBrowserUrl(`https://example.com/${'a'.repeat(3000)}`)).toThrow()
  })
})

describe('isSensitiveText', () => {
  it('flags payment and send actions', () => {
    for (const text of [
      'Place order',
      'Buy now',
      'Confirm payment',
      'Pay now',
      'Send message',
      'Complete checkout',
      'Delete account'
    ]) {
      expect(isSensitiveText(text)).toBe(true)
    }
  })

  it('does not flag ordinary prose', () => {
    expect(isSensitiveText('Search results for lofi hip hop')).toBe(false)
    expect(isSensitiveText('Open the settings page')).toBe(false)
  })
})

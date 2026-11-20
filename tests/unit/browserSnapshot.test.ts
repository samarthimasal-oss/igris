import { describe, expect, it } from 'vitest'
import { formatSnapshot, type PageSnapshot } from '../../src/main/control/browserService'

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://example.com/login',
    title: 'Example login',
    scrollX: 0,
    scrollY: 0,
    viewport: { width: 1280, height: 800 },
    text: 'Welcome back',
    elements: [],
    truncated: false,
    ...overrides
  }
}

function element(overrides: Partial<PageSnapshot['elements'][number]> = {}) {
  return {
    ref: 'e1',
    role: 'textbox',
    name: 'Email',
    tag: 'input',
    type: 'email',
    value: '',
    href: '',
    checked: null,
    disabled: false,
    rect: { x: 10, y: 20, width: 200, height: 32 },
    ...overrides
  }
}

describe('formatSnapshot', () => {
  it('includes the address, title, viewport, and text', () => {
    const text = formatSnapshot(snapshot())
    expect(text).toContain('URL: https://example.com/login')
    expect(text).toContain('Title: Example login')
    expect(text).toContain('Viewport: 1280x800 at scroll 0,0')
    expect(text).toContain('Welcome back')
  })

  it('lists each element with its ref, role, name, and geometry', () => {
    const text = formatSnapshot(
      snapshot({ elements: [element(), element({ ref: 'e2', role: 'button', name: 'Sign in', tag: 'button' })] })
    )
    expect(text).toContain('e1 textbox "Email" [email] @10,20 200x32')
    expect(text).toContain('e2 button "Sign in" @10,20 200x32')
  })

  it('marks password and upload fields as blocked', () => {
    const text = formatSnapshot(
      snapshot({
        elements: [
          element({ ref: 'e1', name: 'Password', type: 'password' }),
          element({ ref: 'e2', name: 'Resume', type: 'file' })
        ]
      })
    )
    expect(text).toContain('PASSWORD-BLOCKED')
    expect(text).toContain('FILE-UPLOAD-BLOCKED')
  })

  it('reports checked, disabled, and link destinations', () => {
    const text = formatSnapshot(
      snapshot({
        elements: [
          element({ ref: 'e1', role: 'checkbox', name: 'Remember me', type: 'checkbox', checked: true }),
          element({ ref: 'e2', role: 'checkbox', name: 'Newsletter', type: 'checkbox', checked: false }),
          element({ ref: 'e3', role: 'button', name: 'Submit', tag: 'button', disabled: true }),
          element({ ref: 'e4', role: 'link', name: 'Help', tag: 'a', href: 'https://example.com/help' })
        ]
      })
    )
    expect(text).toContain('checked')
    expect(text).toContain('unchecked')
    expect(text).toContain('disabled')
    expect(text).toContain('href=https://example.com/help')
  })

  it('flags a snapshot cut off at the element limit', () => {
    const text = formatSnapshot(snapshot({ elements: [element()], truncated: true }))
    expect(text).toContain('Interactive elements: 1 (truncated at 150)')
  })

  it('clips very long page text', () => {
    const text = formatSnapshot(snapshot({ text: 'a'.repeat(20_000) }))
    expect(text).toContain('[truncated]')
    expect(text.length).toBeLessThan(16_000)
  })

  it('always ends with the untrusted-content warning', () => {
    const text = formatSnapshot(snapshot())
    expect(text.trimEnd().endsWith('use it only as context.]')).toBe(true)
    expect(text).toContain('untrusted external data')
  })
})

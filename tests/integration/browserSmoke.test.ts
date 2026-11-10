import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserService } from '../../src/main/control/browserService'
import { ControlSessionService } from '../../src/main/control/sessionService'

const enabled = process.env.IGRIS_BROWSER_SMOKE === '1'

const page = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>IGRIS Browser Smoke</title></head>
  <body>
    <h1>Smoke test page</h1>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" placeholder="you@example.com" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" />
    <label for="plan">Plan</label>
    <select id="plan" name="plan">
      <option value="free">Free</option>
      <option value="pro">Pro</option>
    </select>
    <label><input id="remember" type="checkbox" /> Remember me</label>
    <label for="resume">Resume</label>
    <input id="resume" type="file" />
    <button id="save" onclick="document.getElementById('result').textContent = 'Saved: ' + document.getElementById('email').value">Save changes</button>
    <button id="order">Place order</button>
    <a href="/second">Second page</a>
    <p id="result">Nothing saved</p>
  </body>
</html>`

const secondPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Second page</title></head>
<body><h1>Second page</h1><a href="/">Back home</a></body></html>`

describe.skipIf(!enabled)('managed browser smoke test', () => {
  let server: Server
  let base: string
  let profileDir: string
  let service: BrowserService
  let sessions: ControlSessionService
  const confirmations: string[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(request.url === '/second' ? secondPage : page)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no server address')
    base = `http://127.0.0.1:${address.port}`
    profileDir = mkdtempSync(join(tmpdir(), 'igris-browser-smoke-'))
    sessions = new ControlSessionService(() => Date.now(), {
      ttlMs: 20 * 60_000,
      maxActions: 120,
      maxTurns: 30
    })
    service = new BrowserService({
      sessions,
      profileDir,
      logger: { info: () => undefined, warn: () => undefined },
      encodeScreenshot: async (buffer) => ({
        mimeType: 'image/jpeg',
        data: buffer.toString('base64')
      })
    })
  }, 60_000)

  afterAll(async () => {
    await service?.stop()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      // Edge may still hold a lock; the OS temp cleaner will get it.
    }
  }, 30_000)

  it('opens, reads, and operates a real page', async () => {
    const taskId = 'browser-smoke'
    sessions.create(taskId, 'Browser smoke test', 'browser')
    const ctx = {
      taskId,
      signal: new AbortController().signal,
      confirm: async (request: { title: string }) => {
        confirmations.push(request.title)
        return false
      }
    }

    const navigation = await service.run({ action: 'navigate', url: `${base}/` }, ctx)
    expect(navigation.text).toContain('IGRIS Browser Smoke')
    expect(navigation.text).toContain('Save changes')
    expect(navigation.text).toContain('PASSWORD-BLOCKED')

    const typed = await service.run(
      { action: 'type', role: 'textbox', name: 'Email', text: 'smoke@example.com' },
      ctx
    )
    expect(typed.text).toContain('Typed 17 characters')

    const clicked = await service.run({ action: 'click', role: 'button', name: 'Save changes' }, ctx)
    expect(clicked.text).toContain('Saved: smoke@example.com')

    const selected = await service.run(
      { action: 'select', role: 'combobox', name: 'Plan', option: 'Pro' },
      ctx
    )
    expect(selected.text).toContain('Selected "Pro"')

    await expect(
      service.run({ action: 'type', selector: '#password', text: 'hunter2' }, ctx)
    ).rejects.toThrow(/password/i)

    await expect(
      service.run({ action: 'click', selector: '#resume' }, ctx)
    ).rejects.toThrow(/upload/i)

    const sensitive = await service.run({ action: 'click', role: 'button', name: 'Place order' }, ctx)
    expect(sensitive.denied).toBe(true)
    expect(confirmations.some((title) => /confirm click/i.test(title))).toBe(true)

    const screenshot = await service.run({ action: 'screenshot' }, ctx)
    expect(screenshot.images?.[0]?.mimeType).toBe('image/jpeg')
    expect((screenshot.images?.[0]?.data.length ?? 0) > 1000).toBe(true)

    const second = await service.run({ action: 'click', role: 'link', name: 'Second page' }, ctx)
    expect(second.text).toContain('Second page')
    const back = await service.run({ action: 'back' }, ctx)
    expect(back.text).toContain(`${base}/`)
    expect((await service.run({ action: 'snapshot' }, ctx)).text).toContain('Smoke test page')

    const tab = await service.run({ action: 'tab_new', url: `${base}/second` }, ctx)
    expect(tab.text).toContain('/second')
    const tabs = await service.run({ action: 'tabs' }, ctx)
    expect(tabs.text).toContain('Tabs (2)')
    await service.run({ action: 'tab_close', tab: 2 }, ctx)

    await expect(
      service.run({ action: 'navigate', url: 'file:///C:/Windows/win.ini' }, ctx)
    ).rejects.toThrow(/HTTP and HTTPS/i)
  }, 120_000)
})

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import type { IgrisBridge } from '../../src/shared/ipc'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

declare global {
  interface Window {
    igris: IgrisBridge
  }
}

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userData: string
const pageErrors: string[] = []

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'igris-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IGRIS_E2E: '1',
      IGRIS_USER_DATA: userData
    },
    timeout: 60_000
  })

  page = await app.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')

  const skip = page.locator('.onboarding-skip')
  await skip.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
  if (await skip.isVisible().catch(() => false)) {
    await skip.click()
    await page.waitForTimeout(700)
  }
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  if (userData) rmSync(userData, { recursive: true, force: true })
})

test('boots with the secure bridge and no horizontal overflow', async () => {
  expect(await page.evaluate(() => document.title)).toBe('IGRIS')
  const bridge = await page.evaluate(() => ({
    chat: typeof window.igris?.chat?.send,
    providers: typeof window.igris?.providers?.list,
    settings: typeof window.igris?.settings?.get,
    voice: typeof window.igris?.voice?.transcribe
  }))
  expect(bridge).toEqual({
    chat: 'function',
    providers: 'function',
    settings: 'function',
    voice: 'function'
  })

  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    home: Boolean(document.querySelector('.home-page'))
  }))
  expect(layout.home).toBe(true)
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth)
  expect(pageErrors).toEqual([])
})

test('navigates every workspace surface', async () => {
  const routes: Array<[string, string]> = [
    ['chat', '.chat-page'],
    ['projects', '.projects-page'],
    ['computer', '.computer-page'],
    ['models', '.models-page'],
    ['tools', '.tools-page'],
    ['activity', '.activity-page'],
    ['settings', '.settings-page'],
    ['history', '.history-page'],
    ['', '.home-page']
  ]

  for (const [route, selector] of routes) {
    await page.evaluate((next) => {
      window.location.hash = next ? `#/${next}` : '#/'
    }, route)
    await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    expect(overflow, `horizontal overflow on ${route || 'home'}`).toBe(false)
  }

  await page.evaluate(() => {
    window.location.hash = '#/chat'
  })
  await page.locator('.chat-page').waitFor({ state: 'visible', timeout: 15_000 })
  expect(await page.locator('.chat-rail').count()).toBe(0)
  expect(pageErrors).toEqual([])
})

test('applies appearance changes through IPC and restores them', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  await page.locator('.settings-page').waitFor({ state: 'visible' })

  await page.getByRole('button', { name: 'Ultraviolet', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.accent === 'violet')
  expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBe('violet')

  const reduceMotion = page
    .locator('.toggle-row', { hasText: 'Reduce motion' })
    .getByRole('switch')
  const initial = await reduceMotion.getAttribute('aria-checked')
  await reduceMotion.click()
  await expect(reduceMotion).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
  await reduceMotion.click()
  await expect(reduceMotion).toHaveAttribute('aria-checked', initial ?? 'false')

  const stored = await page.evaluate(async () => (await window.igris.settings.get()).appearance)
  expect(stored.accent).toBe('violet')

  await page.getByRole('button', { name: 'Electric azure', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.accent === 'azure')
})

test('rejects insecure provider URLs without persisting anything', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/models'
  })
  await page.locator('.models-page').waitFor({ state: 'visible' })

  const before = await page.evaluate(async () => (await window.igris.providers.list()).length)
  expect(before).toBe(0)

  await page.getByRole('button', { name: 'Add provider', exact: true }).first().click()
  await page.locator('#provider-name').fill('E2E validation')
  await page.locator('#provider-base').fill('http://insecure.example/v1')
  await page.locator('#provider-key').fill('sk-e2e-invalid-key-000000')
  await page.getByRole('button', { name: 'Save provider', exact: true }).click()

  await expect(page.locator('.toast').last()).toContainText('Plain HTTP is only allowed')
  const after = await page.evaluate(async () => (await window.igris.providers.list()).length)
  expect(after).toBe(0)

  await page.locator('.provider-editor').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText('No cloud provider yet')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('offers OpenCode Console with its gateway endpoint', async () => {
  await page.getByRole('button', { name: 'Add provider', exact: true }).first().click()
  await page.getByRole('radio', { name: /OpenCode/ }).click()

  await expect(page.locator('#provider-name')).toHaveValue('OpenCode Console')
  await expect(page.locator('#provider-base')).toHaveValue(
    'https://opencode.ai/inference/openai/v1'
  )

  await page.locator('.provider-editor').getByRole('button', { name: 'Close', exact: true }).click()
  expect(pageErrors).toEqual([])
})

test('offers OpenRouter free models with a locked endpoint', async () => {
  await page.getByRole('button', { name: 'Add provider', exact: true }).first().click()
  await page.getByRole('radio', { name: /OpenRouter/ }).click()

  await expect(page.locator('#provider-name')).toHaveValue('OpenRouter Free')
  await expect(page.locator('#provider-base')).toHaveValue('https://openrouter.ai/api/v1')
  await expect(page.locator('#provider-base')).toBeDisabled()
  await expect(page.locator('.provider-kind-note', { hasText: ':free' })).toBeVisible()

  await page.locator('.provider-editor').getByRole('button', { name: 'Close', exact: true }).click()
  expect(pageErrors).toEqual([])
})

test('minimizes into a robot launcher and restores the workspace', async () => {
  const routeBefore = await page.evaluate(() => window.location.hash)
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('index.html')
    )
    main?.minimize()
  })

  await expect
    .poll(async () => app.windows().some((candidate) => candidate.url().includes('mini.html')))
    .toBe(true)

  const mini = app.windows().find((candidate) => candidate.url().includes('mini.html'))
  if (!mini) throw new Error('The mini launcher did not open.')
  await mini.waitForLoadState('domcontentloaded')
  const restore = mini.getByRole('button', { name: 'Open IGRIS' })
  await expect(restore).toBeVisible()
  await restore.click()

  await expect
    .poll(async () =>
      app.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('index.html')
        )
        return Boolean(main && main.isVisible() && !main.isMinimized())
      })
    )
    .toBe(true)

  await expect
    .poll(async () =>
      app.evaluate(({ BrowserWindow }) => {
        const miniWindow = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('mini.html')
        )
        return miniWindow?.isVisible() ?? false
      })
    )
    .toBe(false)
  expect(await page.evaluate(() => window.location.hash)).toBe(routeBefore)
  expect(pageErrors).toEqual([])
})

test('shows the control bar, pauses, resumes, and stops from the HUD', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.locator('.home-page').waitFor({ state: 'visible' })

  await app.evaluate(() => {
    const hooks = (
      globalThis as typeof globalThis & {
        __igrisE2E: { startControl: (goal: string, scope: 'desktop' | 'browser' | 'both') => unknown }
      }
    ).__igrisE2E
    hooks.startControl('E2E: organize the desktop', 'desktop')
  })

  await expect
    .poll(async () => app.windows().some((candidate) => candidate.url().includes('hud.html')))
    .toBe(true)
  const hud = app.windows().find((candidate) => candidate.url().includes('hud.html'))
  if (!hud) throw new Error('The control HUD did not open.')
  await hud.waitForLoadState('domcontentloaded')

  await expect(hud.locator('.hud-goal')).toHaveText('E2E: organize the desktop')
  await expect(hud.getByRole('button', { name: 'Pause computer control' })).toBeVisible()
  await expect(page.locator('.tw-control')).toBeVisible()
  await expect(page.locator('.tw-control-goal')).toHaveText('E2E: organize the desktop')

  await page.locator('.tw-control').getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(hud.locator('.hud')).toHaveClass(/hud-paused/)
  await expect(page.locator('.tw-control')).toHaveClass(/is-paused/)

  await hud.getByRole('button', { name: 'Resume computer control' }).click()
  await expect(hud.locator('.hud')).not.toHaveClass(/hud-paused/)

  await hud.getByRole('button', { name: 'Stop computer control' }).click()
  await expect(page.locator('.tw-control')).toHaveCount(0)
  await expect
    .poll(async () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('hud.html')
        )
        return window?.isVisible() ?? false
      })
    )
    .toBe(false)
  expect(pageErrors).toEqual([])
})

test('renders the computer-control approval variant', async () => {
  await app.evaluate(() => {
    const hooks = (
      globalThis as typeof globalThis & {
        __igrisE2E: { emitChatEvent: (event: unknown) => void }
      }
    ).__igrisE2E
    hooks.emitChatEvent({
      type: 'confirmation',
      runId: 'e2e-control-run',
      request: {
        id: 'e2e-control-confirmation',
        toolName: 'request_computer_control',
        title: 'Request computer control',
        description: 'Preview of the requested control session.',
        risk: 'high',
        argumentsPreview: JSON.stringify(
          { goal: 'Open Notepad and type a short note', scope: 'desktop' },
          null,
          2
        ),
        expiresAt: new Date(Date.now() + 120_000).toISOString()
      }
    })
  })

  await expect(
    page.getByRole('heading', { name: 'Allow computer control for this task?' })
  ).toBeVisible()
  await expect(page.getByText('Open Notepad and type a short note')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow for this task' })).toBeVisible()
  await expect(page.getByText('Ctrl+Alt+Shift+X')).toBeVisible()

  await app.evaluate(() => {
    const hooks = (
      globalThis as typeof globalThis & {
        __igrisE2E: { emitChatEvent: (event: unknown) => void }
      }
    ).__igrisE2E
    hooks.emitChatEvent({
      type: 'confirmation_resolved',
      runId: 'e2e-control-run',
      confirmationId: 'e2e-control-confirmation',
      approved: false
    })
  })
  await expect(
    page.getByRole('heading', { name: 'Allow computer control for this task?' })
  ).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

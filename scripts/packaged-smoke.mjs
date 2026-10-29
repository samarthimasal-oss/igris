import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const executable = join(process.cwd(), 'release', 'win-unpacked', 'IGRIS.exe')
if (!existsSync(executable)) {
  console.error(`Packaged app not found at ${executable}. Run "npm run pack" first.`)
  process.exit(1)
}

const userData = mkdtempSync(join(tmpdir(), 'igris-packaged-'))
let app
try {
  app = await electron.launch({
    executablePath: executable,
    env: { ...process.env, IGRIS_E2E: '1', IGRIS_USER_DATA: userData },
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.onboarding-skip').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
  if (await page.locator('.onboarding-skip').isVisible().catch(() => false)) {
    await page.locator('.onboarding-skip').click()
  }
  await page.locator('.home-page').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.title(), 'IGRIS')
  assert.equal(await page.evaluate(() => typeof window.igris?.chat?.send), 'function')
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  await page.locator('.settings-page').waitFor({ state: 'visible', timeout: 15_000 })
  console.log('Packaged smoke test passed: IGRIS.exe booted, bridged, and routed to Settings.')
} finally {
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
}

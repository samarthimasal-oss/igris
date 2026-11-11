import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

  // Desktop control ships as a real bundled asset. The app copies it to
  // userData at boot, so its presence proves the asset survived packaging.
  const operatorPath = join(userData, 'operator', 'operator.ps1')
  for (let i = 0; i < 40 && !existsSync(operatorPath); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(existsSync(operatorPath), true, 'the packaged operator.ps1 was not copied to userData')
  assert.match(readFileSync(operatorPath, 'utf8'), /releaseAll/, 'the operator script is incomplete')

  // Opening a control session proves the packaged HUD renderer is present.
  await app.evaluate(() => {
    globalThis.__igrisE2E.startControl('Packaged HUD check', 'desktop')
  })
  for (let i = 0; i < 50; i += 1) {
    if (app.windows().some((candidate) => candidate.url().includes('hud.html'))) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    app.windows().some((candidate) => candidate.url().includes('hud.html')),
    true,
    'the packaged HUD renderer did not open'
  )
  await app.evaluate(() => {
    globalThis.__igrisE2E.stopControl()
  })

  console.log(
    'Packaged smoke test passed: IGRIS.exe booted, bridged, routed to Settings, and loaded the control operator and HUD.'
  )
} finally {
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
}

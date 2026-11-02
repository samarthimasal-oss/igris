import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'screenshots')
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, IGRIS_E2E: '1' },
  timeout: 60000
})

const page = await app.firstWindow()
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[renderer:${message.type()}] ${message.text()}`)
  }
})
page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`))

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2500)

const shot = async (name) => {
  await page.screenshot({ path: join(outDir, name), animations: 'disabled' })
  console.log(`captured ${name}`)
}

await shot('01-initial.png')

const skip = page.locator('.onboarding-skip')
if (await skip.isVisible().catch(() => false)) {
  await skip.click()
  await page.waitForTimeout(600)
}

await shot('02-home.png')

const routes = [
  ['chat', '03-chat.png'],
  ['projects', '04-projects.png'],
  ['computer', '05-computer.png'],
  ['models', '06-models.png'],
  ['tools', '07-tools.png'],
  ['activity', '08-activity.png'],
  ['settings', '09-settings.png'],
  ['history', '12-history.png']
]

for (const [route, file] of routes) {
  await page.evaluate((next) => {
    window.location.hash = `#/${next}`
  }, route)
  await page.waitForTimeout(700)
  await shot(file)
}

// Settings: scroll to show a second section.
await page.evaluate(() => {
  document.getElementById('settings-permissions')?.scrollIntoView({ block: 'start' })
})
await page.waitForTimeout(500)
await shot('10-settings-permissions.png')

await page.evaluate(() => {
  window.location.hash = '#/'
})
await page.waitForTimeout(400)

await page.evaluate(() => {
  window.location.hash = '#/chat'
})
await page.waitForTimeout(2200)
await page.screenshot({ path: join(outDir, '11-chat.png'), animations: 'disabled' })
console.log('captured 11-chat.png')

// Minimized launcher.
await app.evaluate(({ BrowserWindow }) => {
  const main = BrowserWindow.getAllWindows().find((candidate) =>
    candidate.webContents.getURL().includes('index.html')
  )
  main?.minimize()
})
await page.waitForTimeout(1000)
const mini = app.windows().find((candidate) => candidate.url().includes('mini.html'))
if (mini) {
  await mini.waitForLoadState('domcontentloaded')
  await mini.waitForTimeout(500)
  await mini.evaluate(() => {
    document.documentElement.style.background = '#171b22'
    document.body.style.background = '#171b22'
  })
  await mini.screenshot({ path: join(outDir, '13-mini.png') })
  console.log('captured 13-mini.png')
  await mini.getByRole('button', { name: 'Open IGRIS' }).click()
  await page.waitForTimeout(900)
} else {
  console.log('mini launcher not found')
}

// Quick DOM audit: report horizontal overflow and key layout boxes.
const audit = await page.evaluate(() => {
  const pages = ['.home-page', '.chat-page', '.projects-page', '.computer-page', '.models-page', '.tools-page', '.activity-page', '.settings-page', '.history-page']
  return {
    title: document.title,
    size: { width: window.innerWidth, height: window.innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    visiblePage: pages.find((selector) => {
      const node = document.querySelector(selector)
      return node && node.getBoundingClientRect().height > 0
    }),
    theme: document.documentElement.dataset.accent,
    hasBridge: Boolean(window.igris)
  }
})
console.log(JSON.stringify(audit, null, 2))

await app.close()
console.log('closed')

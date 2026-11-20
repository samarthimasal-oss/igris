#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(process.cwd(), 'src', 'main', 'control', 'operator.ps1')
if (!existsSync(script)) {
  console.error(`Missing operator script at ${script}`)
  process.exit(1)
}

const child = spawn(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
)

let buffer = ''
let nextId = 1
const pending = new Map()
let handshake
const ready = new Promise((resolve, reject) => {
  handshake = { resolve, reject }
  setTimeout(() => reject(new Error('handshake timed out after 30s')), 30_000)
})

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  while (true) {
    const index = buffer.indexOf('\n')
    if (index < 0) break
    const line = buffer.slice(0, index).replace(/\r$/, '').trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      console.error('unparseable stdout:', line.slice(0, 400))
      continue
    }
    if (message.ready) {
      handshake.resolve(message)
      continue
    }
    const entry = pending.get(message.id)
    if (!entry) continue
    pending.delete(message.id)
    if (message.ok) entry.resolve(message.data)
    else entry.reject(new Error(message.error))
  }
})

child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  const text = String(chunk).trim()
  if (text) console.error('[operator]', text.slice(0, 1200))
})

function request(cmd, args = {}, timeoutMs = 20_000) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${cmd} timed out`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })
    child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`)
  })
}

function print(label, value) {
  console.log(`\n== ${label} ==`)
  console.log(JSON.stringify(value, null, 2)?.slice(0, 4000))
}

try {
  const hello = await ready
  print('handshake', hello)

  const state = await request('state')
  print('state', state)

  const windows = await request('listWindows')
  print('windows', Array.isArray(windows) ? windows.slice(0, 8) : windows)

  const foreground = await request('foreground')
  print('foreground', foreground)

  const screenshotPath = join(tmpdir(), 'igris-operator-smoke.png')
  const shot = await request('screenshot', { path: screenshotPath })
  print('screenshot', shot)
  if (!existsSync(screenshotPath)) throw new Error('screenshot file was not written')

  const elements = await request('getElements', {
    handle: foreground?.handle ?? 0,
    max: 30,
    depth: 6
  })
  print('elements', {
    window: elements?.window,
    count: elements?.elements?.length,
    sample: elements?.elements?.slice(0, 6)
  })

  if (process.argv.includes('--full')) {
    print('cursor', await request('cursor'))
    print('keyShift', await request('keyChord', { keys: ['Shift'] }))
    print('release', await request('releaseAll'))
  }

  console.log('\nOperator smoke test passed.')
} catch (error) {
  console.error('\nOperator smoke test failed:', error.message)
  process.exitCode = 1
} finally {
  try {
    await request('shutdown', {}, 2000)
  } catch {
    // Ignore shutdown races.
  }
  child.stdin.end()
  setTimeout(() => {
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }, 500).unref()
}

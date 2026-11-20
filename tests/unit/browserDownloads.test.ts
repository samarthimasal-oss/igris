import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserService } from '../../src/main/control/browserService'
import {
  isBlockedDownloadName,
  MAX_DOWNLOAD_BYTES,
  sanitizeDownloadName
} from '../../src/main/control/policy'

interface FakeDownload {
  suggestedFilename: () => string
  url: () => string
  failure: () => Promise<string | null>
  path: () => Promise<string | null>
  saveAs: (target: string) => Promise<void>
  cancel: () => Promise<void>
  delete: () => Promise<void>
}

interface DownloadCalls {
  cancel: number
  delete: number
  saveAs: string[]
}

let dir = ''
let tempFile = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'igris-downloads-'))
  tempFile = join(dir, 'payload.tmp')
  writeFileSync(tempFile, 'hello')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fakeDownload(overrides: Partial<FakeDownload> = {}): {
  download: FakeDownload
  calls: DownloadCalls
} {
  const calls: DownloadCalls = { cancel: 0, delete: 0, saveAs: [] }
  const download: FakeDownload = {
    suggestedFilename: () => 'report.pdf',
    url: () => 'https://example.com/files/report.pdf',
    failure: async () => null,
    path: async () => tempFile,
    saveAs: async (target: string) => {
      calls.saveAs.push(target)
    },
    cancel: async () => {
      calls.cancel += 1
    },
    delete: async () => {
      calls.delete += 1
    },
    ...overrides
  }
  return { download, calls }
}

function makeService(options: {
  state?: { status: string; scope: string } | null | (() => { status: string; scope: string } | null)
  choose?: (input: { suggestedName: string; sourceUrl: string }) => Promise<string | null>
  maxDownloadBytes?: number
} = {}): {
  service: BrowserService
  events: string[]
  chooserInputs: Array<{ suggestedName: string; sourceUrl: string }>
} {
  const events: string[] = []
  const chooserInputs: Array<{ suggestedName: string; sourceUrl: string }> = []
  const state = options.state !== undefined ? options.state : { status: 'active', scope: 'browser' }
  const service = new BrowserService({
    sessions: {
      activeState: typeof state === 'function' ? state : () => state
    },
    profileDir: 'C:/tmp/igris-test-profile',
    logger: {
      info: (_scope: string, message: string) => events.push(message),
      warn: (_scope: string, message: string) => events.push(message)
    },
    encodeScreenshot: async () => null,
    chooseDownloadPath: async (input: { suggestedName: string; sourceUrl: string }) => {
      chooserInputs.push(input)
      return options.choose ? options.choose(input) : join(dir, 'saved.pdf')
    },
    maxDownloadBytes: options.maxDownloadBytes
  } as never)
  return { service, events, chooserInputs }
}

async function handle(service: BrowserService, download: FakeDownload): Promise<void> {
  await (
    service as unknown as { handleDownload: (download: FakeDownload) => Promise<void> }
  ).handleDownload(download)
}

function summary(service: BrowserService): string | null {
  return (service as unknown as { downloadSummary: () => string | null }).downloadSummary()
}

describe('download policy', () => {
  it('reduces suggested names to a safe basename', () => {
    expect(sanitizeDownloadName('../../Windows/evil.txt')).toBe('evil.txt')
    expect(sanitizeDownloadName('C:\\Temp\\report.pdf')).toBe('report.pdf')
    expect(sanitizeDownloadName('a<b>c|d?.pdf')).toBe('a_b_c_d_.pdf')
    expect(sanitizeDownloadName('trailing.  ')).toBe('trailing')
    expect(sanitizeDownloadName('CON.txt')).toBe('_CON.txt')
    expect(sanitizeDownloadName('')).toBe('download')
  })

  it('blocks executables, installers, and scripts case-insensitively', () => {
    expect(isBlockedDownloadName('setup.exe')).toBe(true)
    expect(isBlockedDownloadName('REPORT.PDF.exe')).toBe(true)
    expect(isBlockedDownloadName('macro.js')).toBe(true)
    expect(isBlockedDownloadName('script.ps1')).toBe(true)
    expect(isBlockedDownloadName('archive.msi')).toBe(true)
    expect(isBlockedDownloadName('report.pdf')).toBe(false)
    expect(isBlockedDownloadName('photo.jpeg')).toBe(false)
    expect(isBlockedDownloadName('notes')).toBe(false)
  })
})

describe('approval-gated downloads', () => {
  it('saves only after the user picks a destination', async () => {
    const target = join(dir, 'saved.pdf')
    const { service, chooserInputs } = makeService()
    const { download, calls } = fakeDownload()

    await handle(service, download)

    expect(chooserInputs).toEqual([
      { suggestedName: 'report.pdf', sourceUrl: 'https://example.com/files/report.pdf' }
    ])
    expect(calls.saveAs).toEqual([target])
    expect(calls.cancel).toBe(0)
    expect(summary(service)).toContain('report.pdf: saved')
    expect(summary(service)).toContain(target)
  })

  it('denies the download when the user cancels the dialog', async () => {
    const { service } = makeService({ choose: async () => null })
    const { download, calls } = fakeDownload()

    await handle(service, download)

    expect(calls.saveAs).toEqual([])
    expect(calls.cancel).toBe(1)
    expect(calls.delete).toBe(1)
    expect(summary(service)).toContain('report.pdf: denied')
  })

  it('denies without prompting when no browser session is active, paused, or desktop-only', async () => {
    for (const state of [
      null,
      { status: 'paused', scope: 'browser' },
      { status: 'active', scope: 'desktop' }
    ]) {
      const { service, chooserInputs } = makeService({ state })
      const { download, calls } = fakeDownload()
      await handle(service, download)
      expect(chooserInputs).toHaveLength(0)
      expect(calls.saveAs).toEqual([])
      expect(summary(service)).toContain('denied')
    }
  })

  it('refuses executables before asking the user', async () => {
    const { service, chooserInputs } = makeService()
    const { download, calls } = fakeDownload({ suggestedFilename: () => 'installer.EXE' })

    await handle(service, download)

    expect(chooserInputs).toHaveLength(0)
    expect(calls.saveAs).toEqual([])
    expect(calls.cancel).toBe(1)
    expect(summary(service)).toContain('installer.EXE: blocked')
  })

  it('records a failed transfer and never saves it', async () => {
    const { service } = makeService()
    const { download, calls } = fakeDownload({
      failure: async () => 'net::ERR_CONNECTION_RESET'
    })

    await handle(service, download)

    expect(calls.saveAs).toEqual([])
    expect(summary(service)).toContain('net::ERR_CONNECTION_RESET')
  })

  it('refuses files above the size limit', async () => {
    const { service } = makeService({ maxDownloadBytes: 4 })
    const { download, calls } = fakeDownload()

    await handle(service, download)

    expect(calls.saveAs).toEqual([])
    expect(calls.cancel).toBe(1)
    expect(summary(service)).toContain('larger than the 0 MB limit')
  })

  it('re-checks the session after the dialog and does not save if control ended', async () => {
    let calls = 0
    const { service } = makeService({
      state: () => {
        calls += 1
        return calls === 1 ? { status: 'active', scope: 'browser' } : null
      }
    })
    const { download, calls: downloadCalls } = fakeDownload()

    await handle(service, download)

    expect(downloadCalls.saveAs).toEqual([])
    expect(summary(service)).toContain('control ended before the file was saved')
  })

  it('exposes the 200 MB default limit', () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(200 * 1024 * 1024)
  })
})

import { shell } from 'electron'
import { AppError } from '../security/errors'
import type { Logger } from '../services/logger'

/**
 * Web tools hand every navigation to the user's default browser. IGRIS never
 * embeds a browser, so it cannot read, click, or fill pages in Chrome or Edge.
 */
export class BrowserService {
  constructor(private readonly logger: Logger) {}

  private assertHttpUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new AppError('VALIDATION', 'Enter a valid web address.')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError('BROWSER', 'IGRIS only opens HTTP and HTTPS pages.')
    }
    if (url.username || url.password) {
      throw new AppError('BROWSER', 'Credentials embedded in URLs are not allowed.')
    }
    return url.toString()
  }

  async openExternalPage(url: string): Promise<void> {
    const safe = this.assertHttpUrl(url)
    try {
      await shell.openExternal(safe)
    } catch (error) {
      this.logger.error('browser', 'Windows could not open the default browser.')
      throw new AppError('BROWSER', 'Windows could not open your default browser.', {
        cause: error
      })
    }
    this.logger.info('browser', 'Opened a page in the default browser.')
  }

  async search(query: string): Promise<string> {
    const clean = query.trim()
    if (!clean) throw new AppError('VALIDATION', 'Enter a search query.')
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(clean.slice(0, 300))}`
    await this.openExternalPage(url)
    return url
  }

  async searchYoutube(query: string): Promise<string> {
    const clean = query.trim()
    if (!clean) throw new AppError('VALIDATION', 'Enter a YouTube search query.')
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(clean.slice(0, 300))}`
    await this.openExternalPage(url)
    return url
  }
}

import { desktopCapturer, screen } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScreenCapture, ScreenStatus } from '@shared/types'
import { AppError } from '../security/errors'

export class ScreenService {
  constructor(private readonly screenshotDir: string) {}

  status(): ScreenStatus {
    try {
      const displays = screen.getAllDisplays()
      if (!displays.length) return { supported: false, detail: 'Windows did not report a display.' }
      return {
        supported: true,
        detail: `${displays.length} display${displays.length === 1 ? '' : 's'} detected.`
      }
    } catch (error) {
      return {
        supported: false,
        detail: error instanceof Error ? error.message : 'Screen vision is unavailable.'
      }
    }
  }

  async capture(): Promise<ScreenCapture> {
    const primary = screen.getPrimaryDisplay()
    const scale = Math.min(1, 1920 / Math.max(1, primary.size.width * primary.scaleFactor))
    const targetWidth = Math.round(primary.size.width * primary.scaleFactor * scale)
    const targetHeight = Math.round(primary.size.height * primary.scaleFactor * scale)

    let sources
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: targetWidth, height: targetHeight },
        fetchWindowIcons: false
      })
    } catch (error) {
      throw new AppError('PERMISSION', 'Windows blocked the screen capture request.', { cause: error })
    }
    const source =
      sources.find((entry) => entry.display_id === String(primary.id)) ?? sources[0]
    if (!source) {
      throw new AppError(
        'PERMISSION',
        'No screen source was available. Check Windows screen-capture permissions.'
      )
    }
    const thumbnail = source.thumbnail
    if (thumbnail.isEmpty()) {
      throw new AppError(
        'PERMISSION',
        'Windows returned an empty screen image. Check screen-capture permissions.'
      )
    }
    const size = thumbnail.getSize()
    const png = thumbnail.toPNG()
    if (!png.length) {
      throw new AppError('INTERNAL', 'The screenshot could not be encoded.')
    }
    mkdirSync(this.screenshotDir, { recursive: true })
    const file = join(
      this.screenshotDir,
      `igris-screen-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    )
    writeFileSync(file, png)
    return {
      path: file,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      width: size.width,
      height: size.height,
      capturedAt: new Date().toISOString()
    }
  }
}

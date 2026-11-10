import { nativeImage, type NativeImage } from 'electron'
import type { ToolImage } from '@shared/types'

/** The model never needs more than this; it keeps vision tokens and logs small. */
const MAX_WIDTH = 1280
const JPEG_QUALITY = 72

export function encodeNativeImage(image: NativeImage, maxWidth = MAX_WIDTH): ToolImage | null {
  if (image.isEmpty()) return null
  const size = image.getSize()
  if (!size.width || !size.height) return null
  const scale = Math.min(1, maxWidth / size.width)
  const sized =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good'
        })
      : image
  const jpeg = sized.toJPEG(JPEG_QUALITY)
  if (!jpeg.length) return null
  return { mimeType: 'image/jpeg', data: jpeg.toString('base64') }
}

export function encodeScreenshotFile(path: string): ToolImage | null {
  return encodeNativeImage(nativeImage.createFromPath(path))
}

export function encodeScreenshotBuffer(buffer: Buffer): ToolImage | null {
  return encodeNativeImage(nativeImage.createFromBuffer(buffer))
}

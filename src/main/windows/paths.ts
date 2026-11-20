import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

export function mainPageUrl(route = '/'): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const base = devUrl.replace(/\/+$/, '')
    return `${base}/#${route}`
  }
  const file = pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  return `${file}#${route}`
}

export function miniPageUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return `${devUrl.replace(/\/+$/, '')}/mini.html`
  return pathToFileURL(join(__dirname, '../renderer/mini.html')).toString()
}

export function hudPageUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return `${devUrl.replace(/\/+$/, '')}/hud.html`
  return pathToFileURL(join(__dirname, '../renderer/hud.html')).toString()
}

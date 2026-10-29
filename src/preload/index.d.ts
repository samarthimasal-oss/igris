import type { IgrisBridge } from '@shared/ipc'

declare global {
  interface Window {
    igris: IgrisBridge
  }
}

export {}

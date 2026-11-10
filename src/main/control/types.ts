export interface OperatorRect {
  x: number
  y: number
  width: number
  height: number
}

export interface OperatorWindowInfo {
  handle: number
  title: string
  className: string
  process: string
  pid: number
  rect: OperatorRect
  minimized: boolean
  maximized: boolean
  foreground: boolean
  elevated: boolean
}

export interface OperatorMonitor {
  x: number
  y: number
  width: number
  height: number
  work: OperatorRect
  primary: boolean
}

export interface OperatorState {
  version: number
  cursor: { x: number; y: number }
  foreground: OperatorWindowInfo | null
  virtualScreen: OperatorRect
  monitors: OperatorMonitor[]
  processElevated: boolean
  windows: number
}

export interface OperatorElement {
  refId: string
  role: string
  name: string
  automationId: string
  bounds: OperatorRect
  enabled: boolean
  offscreen: boolean
  password: boolean
  focusable: boolean
  patterns: string[]
}

export interface OperatorElements {
  window: OperatorWindowInfo | null
  elements: OperatorElement[]
  truncated: boolean
}

export interface OperatorScreenshot {
  path: string
  x: number
  y: number
  width: number
  height: number
  capturedAt: string
}

export interface OperatorFocusResult {
  focused: boolean
  window: OperatorWindowInfo
}

export interface OperatorValueResult {
  value: string
}

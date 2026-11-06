export type DiffKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffKind
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface FileDiff {
  hunks: DiffHunk[]
  added: number
  removed: number
  truncated: boolean
}

interface RawDiff {
  lines: DiffLine[]
  added: number
  removed: number
  truncated: boolean
}

const MAX_LINES = 1600
const CONTEXT = 3

/**
 * Line diff for the project editor review step. Uses a longest-common-subsequence
 * walk for normal files and a prefix/suffix fallback for very large files so the
 * renderer never blocks on an unbounded comparison.
 */
function rawDiff(before: string, after: string): RawDiff {
  const a = before.split('\n')
  const b = after.split('\n')
  const truncated = a.length > MAX_LINES || b.length > MAX_LINES
  const oldLines = truncated ? a.slice(0, MAX_LINES) : a
  const newLines = truncated ? b.slice(0, MAX_LINES) : b
  const n = oldLines.length
  const m = newLines.length

  // Mid-size files can use the exact LCS table; huge ones fall back below.
  if (n * m > 4_000_000) {
    return coarseDiff(oldLines, newLines, truncated)
  }

  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width
    const next = (i + 1) * width
    for (let j = m - 1; j >= 0; j -= 1) {
      table[row + j] =
        oldLines[i] === newLines[j]
          ? table[next + j + 1] + 1
          : Math.max(table[next + j], table[row + j + 1])
    }
  }

  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  let oldLine = 1
  let newLine = 1
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ kind: 'context', oldLine, newLine, text: oldLines[i] })
      i += 1
      j += 1
      oldLine += 1
      newLine += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      lines.push({ kind: 'del', oldLine, newLine: null, text: oldLines[i] })
      i += 1
      oldLine += 1
      removed += 1
    } else {
      lines.push({ kind: 'add', oldLine: null, newLine, text: newLines[j] })
      j += 1
      newLine += 1
      added += 1
    }
  }
  while (i < n) {
    lines.push({ kind: 'del', oldLine, newLine: null, text: oldLines[i] })
    i += 1
    oldLine += 1
    removed += 1
  }
  while (j < m) {
    lines.push({ kind: 'add', oldLine: null, newLine, text: newLines[j] })
    j += 1
    newLine += 1
    added += 1
  }
  return { lines, added, removed, truncated }
}

function coarseDiff(oldLines: string[], newLines: string[], truncated: boolean): RawDiff {
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const lines: DiffLine[] = []
  for (let index = 0; index < prefix; index += 1) {
    lines.push({ kind: 'context', oldLine: index + 1, newLine: index + 1, text: oldLines[index] })
  }
  let removed = 0
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    lines.push({ kind: 'del', oldLine: index + 1, newLine: null, text: oldLines[index] })
    removed += 1
  }
  let added = 0
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    lines.push({ kind: 'add', oldLine: null, newLine: index + 1, text: newLines[index] })
    added += 1
  }
  for (let index = 0; index < suffix; index += 1) {
    const oldIndex = oldLines.length - suffix + index
    const newIndex = newLines.length - suffix + index
    lines.push({
      kind: 'context',
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
      text: oldLines[oldIndex]
    })
  }
  return { lines, added, removed, truncated }
}

function buildHunks(lines: DiffLine[]): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.kind === 'context' ? -1 : index))
    .filter((index) => index >= 0)
  if (!changed.length) return []

  const ranges: Array<[number, number]> = []
  let start = Math.max(0, changed[0] - CONTEXT)
  let end = Math.min(lines.length - 1, changed[0] + CONTEXT)
  for (const index of changed.slice(1)) {
    const nextStart = Math.max(0, index - CONTEXT)
    const nextEnd = Math.min(lines.length - 1, index + CONTEXT)
    if (nextStart <= end + 1) {
      end = Math.max(end, nextEnd)
    } else {
      ranges.push([start, end])
      start = nextStart
      end = nextEnd
    }
  }
  ranges.push([start, end])

  return ranges.map(([from, to]) => {
    const slice = lines.slice(from, to + 1)
    const oldNumbers = slice
      .map((line) => line.oldLine)
      .filter((value): value is number => value !== null)
    const newNumbers = slice
      .map((line) => line.newLine)
      .filter((value): value is number => value !== null)
    return {
      oldStart: oldNumbers[0] ?? 0,
      oldCount: oldNumbers.length,
      newStart: newNumbers[0] ?? 0,
      newCount: newNumbers.length,
      lines: slice
    }
  })
}

export function buildDiff(before: string, after: string): FileDiff {
  const raw = rawDiff(before, after)
  return {
    hunks: buildHunks(raw.lines),
    added: raw.added,
    removed: raw.removed,
    truncated: raw.truncated
  }
}

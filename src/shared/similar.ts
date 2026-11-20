/**
 * Near-duplicate detection for saved memories. Exact matches are caught after
 * normalization (case, punctuation, whitespace); otherwise token-overlap
 * (Jaccard similarity) flags near-identical phrasings.
 */

export interface MemoryLike {
  id: string
  text: string
}

export interface DuplicateMemory {
  id: string
  text: string
  similarity: number
}

function memoryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Finds the existing memory that is the same or near-same text, if any. */
export function findSimilarMemory(
  text: string,
  existing: MemoryLike[],
  threshold = 0.8
): DuplicateMemory | null {
  const tokens = new Set(memoryTokens(text))
  if (tokens.size === 0) return null
  let best: DuplicateMemory | null = null
  for (const memory of existing) {
    const other = new Set(memoryTokens(memory.text))
    const identical = tokens.size === other.size && [...tokens].every((token) => other.has(token))
    if (identical) return { id: memory.id, text: memory.text, similarity: 1 }
    const shared = [...tokens].filter((token) => other.has(token)).length
    const union = new Set([...tokens, ...other]).size
    const similarity = union ? shared / union : 0
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { id: memory.id, text: memory.text, similarity }
    }
  }
  return best
}

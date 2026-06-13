// "Did you mean ...?" support for unknown commands. Pure string distance, no
// dependencies — kept separate from index.ts so it is unit-testable.

/** Levenshtein edit distance between two strings (insert/delete/substitute = 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Single-row DP: prev[j] is the distance for b[0..j] against the previous a-prefix.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j]! + 1,        // deletion
        curr[j - 1]! + 1,    // insertion
        prev[j - 1]! + cost, // substitution
      )
    }
    prev = curr
  }
  return prev[b.length]!
}

export interface SuggestOptions {
  /** Max suggestions to return. Default 3. */
  limit?: number
}

/**
 * Suggest the command names closest to `input`, ranked by edit distance. Returns
 * [] when nothing is close enough to be a likely typo. A candidate sharing the
 * input's namespace (the part before ':') is preferred on ties, so `migrate:froesh`
 * suggests `migrate:fresh` over an equidistant command in another namespace.
 */
export function suggestCommands(input: string, candidates: readonly string[], opts: SuggestOptions = {}): string[] {
  const limit = opts.limit ?? 3
  // Allow more slack for longer inputs; a 2-char typo budget on short names.
  const maxDistance = Math.max(2, Math.floor(input.length / 3))
  const colonIndex = input.indexOf(':')
  const inputNs = colonIndex >= 0 ? input.slice(0, colonIndex) : ''
  const inputNsPrefix = inputNs ? `${inputNs}:` : ''

  const scored = candidates
    .map(name => ({ name, dist: levenshtein(input, name) }))
    .filter(c => c.dist <= maxDistance)
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist
      // Tie-break: same-namespace first, then alphabetical for stability.
      const aNs = inputNsPrefix && a.name.startsWith(inputNsPrefix) ? 0 : 1
      const bNs = inputNsPrefix && b.name.startsWith(inputNsPrefix) ? 0 : 1
      if (aNs !== bNs) return aNs - bNs
      return a.name < b.name ? -1 : 1
    })

  return scored.slice(0, limit).map(c => c.name)
}

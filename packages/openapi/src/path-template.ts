import { ROUTE_PATTERN_NUMBER } from './internal-patterns.js'

export interface PathParam {
  name:    string
  /** True when the segment carries the `whereNumber` regex (`[0-9]+`). */
  integer: boolean
}

export interface ParsedPath {
  /** OpenAPI-templated path: `/users/:id{[0-9]+}` → `/users/{id}`. */
  template: string
  params:   PathParam[]
}

/**
 * Scan a balanced `{ ... }` block starting at `open` (the index of `{`),
 * honouring `\{`/`\}` escapes and nested braces. Returns the index just past
 * the closing `}`. Mirrors the router's own brace scanner so `[0-9]{8}`-style
 * nested quantifiers parse correctly.
 */
function consumeBraceBlock(path: string, open: number): number {
  let depth = 0
  let i = open
  while (i < path.length) {
    const ch = path[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return i
}

/**
 * Convert a router path into an OpenAPI-templated path and the list of its path
 * parameters. Router paths use Hono-style `:param` segments, optionally with a
 * `?` (optional) and/or a `{regex}` constraint (from `where*()`). OpenAPI uses
 * `{param}` templating and treats every path param as required.
 *
 * A param constrained to `[0-9]+` (via `.whereNumber()`) is flagged `integer`
 * so the emitter can type it as an integer instead of a string.
 */
export function parsePath(path: string): ParsedPath {
  let template = ''
  const params: PathParam[] = []
  let i = 0

  while (i < path.length) {
    if (path[i] !== ':') { template += path[i]; i++; continue }

    // Scan `:name`.
    let j = i + 1
    while (j < path.length && /[A-Za-z0-9_]/.test(path[j] ?? '')) j++
    const name = path.slice(i + 1, j)

    // Optional `?`.
    if (path[j] === '?') j++

    // Optional `{regex}` constraint.
    let pattern = ''
    if (path[j] === '{') {
      const end = consumeBraceBlock(path, j)
      pattern = path.slice(j + 1, end - 1)
      j = end
    }

    if (name.length > 0) {
      params.push({ name, integer: pattern === ROUTE_PATTERN_NUMBER })
      template += `{${name}}`
    } else {
      // Not a real param (a bare `:`); copy verbatim.
      template += path.slice(i, j)
    }
    i = j
  }

  return { template, params }
}

/**
 * Lowercase first character. Used for camelCase identifier construction
 * (e.g. class name → foreign key column: `Author` → `authorId`).
 */
export function camelHead(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * Uppercase first character. Used for aggregate suffix construction
 * (`sum` + `views` → `SumViews`).
 */
export function capitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Loose attribute equality used by dirty tracking and relation predicates.
 * Handles primitives, nulls, Dates (by getTime), and plain objects (by JSON
 * round-trip). Returns false for objects that don't round-trip cleanly.
 */
export function attrEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

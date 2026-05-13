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
 * Read a dynamic property by string key from a Model instance (or any
 * object with typed fields). Encapsulates the unsafe-cast that TS otherwise
 * forces at every dynamic-field-access site. Returns `unknown` — the caller
 * is responsible for whatever narrowing is appropriate.
 */
export function readField(obj: object, key: string): unknown {
  return (obj as Record<string, unknown>)[key]
}

/**
 * Write a dynamic property by string key onto a Model instance (or any
 * object with typed fields). Mirror of {@link readField}.
 */
export function writeField(obj: object, key: string, value: unknown): void {
  (obj as Record<string, unknown>)[key] = value
}

/**
 * Delete a dynamic property by string key on a Model instance.
 * Mirror of {@link readField}. Used by `instance.refresh()` when pruning
 * stale fields before re-reading the row.
 */
export function deleteField(obj: object, key: string): void {
  delete (obj as Record<string, unknown>)[key]
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

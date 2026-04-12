/**
 * Tiny HTML templating helper — inlined from `@rudderjs/view`'s `html\`\``,
 * `escapeHtml`, and `SafeString` so telescope doesn't need to pull
 * `@rudderjs/view` (which has a `vike` peer dep that's unwanted baggage
 * for a self-contained debug tool).
 *
 * If `@rudderjs/view` ever drops the Vike peer or splits the HTML helpers
 * into a separate package, this file can be replaced with a one-line
 * `export ... from '@rudderjs/view'`.
 *
 * The semantics match `@rudderjs/view` exactly:
 * - Primitives are escaped via `escapeHtml`
 * - `null`/`undefined`/`false` render as empty string
 * - Arrays recursively render and join (no separator)
 * - `SafeString` instances pass through unchanged (the escape hatch for
 *   composing nested templates or injecting trusted markup)
 */

export class SafeString {
  constructor(public readonly value: string) {}
  toString(): string { return this.value }
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderHtmlValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value instanceof SafeString) return value.value
  if (Array.isArray(value)) return value.map(renderHtmlValue).join('')
  return escapeHtml(value)
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeString {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    out += renderHtmlValue(values[i]) + (strings[i + 1] ?? '')
  }
  return new SafeString(out)
}

/** Wrap pre-rendered, trusted HTML so it passes through `html\`\`` interpolation unchanged. */
export function raw(value: string): SafeString {
  return new SafeString(value)
}

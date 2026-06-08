/**
 * Minimal YAML serializer for the OpenAPI document (plain JSON values only:
 * objects, arrays, strings, numbers, booleans, null). Zero-dependency — the
 * document is machine-generated, so we don't need full YAML coverage, just a
 * correct block-style emit for the value shapes the emitter produces.
 */
export function toYaml(value: unknown): string {
  // Trim trailing newlines with a linear loop rather than an anchored `\n+$`
  // regex (which CodeQL flags as a polynomial-regex ReDoS risk on large input).
  const out = emit(value, 0)
  let end = out.length
  while (end > 0 && out.charCodeAt(end - 1) === 10) end--
  return out.slice(0, end) + '\n'
}

function emit(value: unknown, indent: number): string {
  if (value === null || value === undefined) return 'null\n'
  if (typeof value === 'boolean' || typeof value === 'number') return `${String(value)}\n`
  if (typeof value === 'string') return `${scalar(value)}\n`

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]\n'
    const pad = '  '.repeat(indent)
    let out = ''
    for (const item of value) {
      if (isContainer(item)) {
        // Inline the first line after the dash, indent the rest.
        const block = emit(item, indent + 1)
        const lines = block.split('\n')
        const first = lines.shift() ?? ''
        out += `${pad}- ${first.slice((indent + 1) * 2)}\n`
        for (const line of lines) if (line.length > 0) out += `${line}\n`
      } else {
        out += `${pad}- ${emit(item, 0)}`
      }
    }
    return out
  }

  // Object
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}\n'
  const pad = '  '.repeat(indent)
  let out = ''
  for (const [key, val] of entries) {
    const k = `${pad}${scalarKey(key)}:`
    if (isContainer(val) && !isEmptyContainer(val)) {
      out += `${k}\n${emit(val, indent + 1)}`
    } else {
      out += `${k} ${emit(val, 0)}`
    }
  }
  return out
}

function isContainer(v: unknown): boolean {
  return v !== null && typeof v === 'object'
}

function isEmptyContainer(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0
  return isContainer(v) && Object.keys(v as object).length === 0
}

/** Quote a scalar string when YAML would otherwise misread it. */
function scalar(s: string): string {
  if (s === '') return "''"
  if (
    /^[\s]|[\s]$/.test(s) ||                       // leading/trailing space
    /[:#\-?,[\]{}&*!|>'"%@`]/.test(s.charAt(0)) || // indicator at start
    /:\s|\s#/.test(s) ||                           // `: ` or ` #` inside
    /[\n\t]/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[+-]?(\d|\.\d)/.test(s)                       // looks numeric
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
  }
  return s
}

function scalarKey(k: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(k) ? k : scalar(k)
}

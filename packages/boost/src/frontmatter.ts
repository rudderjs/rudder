export interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  if (!source.startsWith('---')) return { data: {}, body: source }

  const end = source.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: source }

  const yaml = source.slice(4, end).trim()
  const body = source.slice(end + 4).replace(/^\n+/, '')

  return { data: parseSimpleYaml(yaml), body }
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = input.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }

    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) { i++; continue }
    const key = m[1]!
    const rest = m[2]!

    if (rest === '') {
      // Either a list or a nested object — peek next line
      const peek = lines[i + 1] ?? ''
      if (/^\s*-\s+/.test(peek)) {
        const arr: string[] = []
        i++
        while (i < lines.length && /^\s*-\s+/.test(lines[i] ?? '')) {
          const item = (lines[i] ?? '').replace(/^\s*-\s+/, '').trim()
          arr.push(unquote(item))
          i++
        }
        result[key] = arr
      } else if (/^\s+\S/.test(peek)) {
        const obj: Record<string, string> = {}
        i++
        while (i < lines.length && /^\s+\S/.test(lines[i] ?? '')) {
          const sub = (lines[i] ?? '').match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
          if (sub) obj[sub[1]!] = unquote(sub[2]!)
          i++
        }
        result[key] = obj
      } else {
        result[key] = ''
        i++
      }
    } else {
      result[key] = unquote(rest)
      i++
    }
  }

  return result
}

function unquote(value: string): string {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

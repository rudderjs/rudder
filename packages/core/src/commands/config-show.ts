import { getConfigRepository } from '@rudderjs/support'

// ─── Redaction ────────────────────────────────────────────

const SENSITIVE_TOKENS = new Set([
  'key', 'secret', 'password', 'token', 'dsn', 'webhook', 'signing',
  'salt', 'pepper', 'credentials', 'credential',
])

// Splits camelCase, snake_case, kebab-case, and dotted keys into lowercase
// tokens. e.g. `signingKey` → ['signing', 'key']; `client_secret` →
// ['client', 'secret']; `apiKey` → ['api', 'key']. Last token is checked
// against SENSITIVE_TOKENS — avoids false positives like `monkey` or
// `donkey` matching a `key` substring.
function shouldRedact(key: string): boolean {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[._-]/)
    .filter(Boolean)
  const last = tokens[tokens.length - 1]
  return last !== undefined && SENSITIVE_TOKENS.has(last)
}

function redact(node: unknown, keyHint: string): unknown {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) return node.map((item, i) => redact(item, `${keyHint}.${i}`))
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = redact(v, k)
    }
    return out
  }
  if (typeof node === 'string' && shouldRedact(keyHint)) {
    return node === '' ? '' : '***'
  }
  return node
}

// ─── Section resolution ───────────────────────────────────

function resolveKey(data: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split('.')
  let current: unknown = data
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !(part in (current as object))) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// ─── Formatting ───────────────────────────────────────────

function countLeaves(node: unknown): number {
  if (node === null || node === undefined) return 1
  if (Array.isArray(node)) return node.length
  if (typeof node === 'object') {
    return Object.values(node as Record<string, unknown>).reduce<number>(
      (sum, v) => sum + countLeaves(v),
      0,
    )
  }
  return 1
}

function formatScalar(value: unknown): string {
  if (value === null) return '\x1b[2mnull\x1b[0m'
  if (value === undefined) return '\x1b[2mundefined\x1b[0m'
  if (typeof value === 'string') return value === '' ? '\x1b[2m""\x1b[0m' : value
  if (typeof value === 'boolean') return value ? '\x1b[35mtrue\x1b[0m' : '\x1b[35mfalse\x1b[0m'
  if (typeof value === 'number') return `\x1b[36m${value}\x1b[0m`
  return String(value)
}

function printTree(node: unknown, indent = 0, maxKeyWidth = 0): void {
  const pad = '  '.repeat(indent)
  if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) {
    console.log(`${pad}${formatScalar(node)}`)
    return
  }
  const entries = Object.entries(node as Record<string, unknown>)
  const keyWidth = maxKeyWidth > 0
    ? maxKeyWidth
    : Math.min(Math.max(...entries.map(([k]) => k.length), 4), 30)
  for (const [k, v] of entries) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      console.log(`${pad}\x1b[1m${k}\x1b[0m:`)
      printTree(v, indent + 1, 0)
    } else if (Array.isArray(v)) {
      console.log(`${pad}\x1b[1m${k}\x1b[0m: \x1b[2m[${v.length} items]\x1b[0m`)
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          console.log(`${pad}  \x1b[2m[${i}]\x1b[0m`)
          printTree(item, indent + 2, 0)
        } else {
          console.log(`${pad}  \x1b[2m[${i}]\x1b[0m ${formatScalar(item)}`)
        }
      })
    } else {
      console.log(`${pad}\x1b[1m${k.padEnd(keyWidth)}\x1b[0m  ${formatScalar(v)}`)
    }
  }
}

function printSectionSummary(data: Record<string, unknown>): void {
  const sections = Object.entries(data)
  if (sections.length === 0) {
    console.log('No config sections registered.')
    return
  }
  const sectionWidth = Math.min(Math.max(...sections.map(([k]) => k.length), 7), 30)
  let totalLeaves = 0
  console.log()
  console.log(`  \x1b[1m${'SECTION'.padEnd(sectionWidth)}  KEYS\x1b[0m`)
  console.log(`  ${'─'.repeat(sectionWidth)}  ${'─'.repeat(6)}`)
  for (const [name, value] of sections) {
    const count = countLeaves(value)
    totalLeaves += count
    console.log(`  ${name.padEnd(sectionWidth)}  ${count}`)
  }
  console.log()
  console.log(`  \x1b[2m${sections.length} section${sections.length === 1 ? '' : 's'}, ${totalLeaves} key${totalLeaves === 1 ? '' : 's'} total.\x1b[0m`)
  console.log()
}

// ─── Command Registration ─────────────────────────────────

/**
 * Register the `config:show` command with the rudder CLI.
 *
 * No args   → top-level section summary (section name → key count).
 * `<key>`   → prints the section or leaf at the dotted key.
 * `--json`  → emits JSON (redacted unless --raw).
 * `--raw`   → disables redaction; prints a stderr warning.
 *
 * Redaction matches keys against `/_?(key|secret|password|token|dsn|webhook|...)$/i`
 * and replaces leaf string values with `***`. Numbers/booleans pass through.
 */
export function registerConfigShowCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('config:show', (args: string[]) => {
    const jsonFlag = args.includes('--json')
    const rawFlag  = args.includes('--raw')
    const positional = args.find(a => !a.startsWith('-')) ?? null

    const repo = getConfigRepository()
    if (!repo) {
      console.error('[config:show] No config repository — ensure the app booted before this command ran.')
      process.exitCode = 1
      return
    }

    const all = repo.all()
    const target = positional ? resolveKey(all, positional) : all
    if (positional && target === undefined) {
      console.error(`[config:show] Key not found: \x1b[33m${positional}\x1b[0m`)
      process.exitCode = 1
      return
    }

    if (rawFlag) {
      console.error('[config:show] \x1b[33m--raw\x1b[0m: redaction disabled, sensitive values will print as-is.')
    }
    const out = rawFlag ? target : redact(target, positional ?? '')

    if (jsonFlag) {
      console.log(JSON.stringify(out, null, 2))
      return
    }

    if (positional) {
      if (typeof out !== 'object' || out === null) {
        console.log(formatScalar(out))
        return
      }
      console.log()
      console.log(`\x1b[1m${positional}\x1b[0m:`)
      printTree(out, 1, 0)
      console.log()
      return
    }

    printSectionSummary(out as Record<string, unknown>)
  }).description('Inspect resolved configuration (config:show [section[.key]] [--json] [--raw])')
}

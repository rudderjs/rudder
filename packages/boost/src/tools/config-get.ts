import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

export function getConfigValue(cwd: string, key?: string): Record<string, unknown> | string {
  const configDir = join(cwd, 'config')
  if (!existsSync(configDir)) return { error: 'No config/ directory found' }

  const files = readdirSync(configDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'))

  if (!key) {
    // Return list of config files
    return {
      files: files.map(f => basename(f, f.endsWith('.ts') ? '.ts' : '.js')),
      hint: 'Pass a key like "app" to read config/app.ts, or "app.name" for a specific value.',
    }
  }

  const [fileKey] = key.split('.')
  const file = files.find(f => basename(f, f.endsWith('.ts') ? '.ts' : '.js') === fileKey)
  if (!file) return { error: `Config file "${fileKey}" not found. Available: ${files.map(f => basename(f, '.ts')).join(', ')}` }

  // Return the file source (we can't import TS at runtime, but the AI can read
  // it) with hardcoded secrets redacted — config files routinely inline
  // fallback secrets, API keys, and credentialed URLs that should not leak.
  const content = readFileSync(join(configDir, file), 'utf8')
  return redactSecrets(content)
}

/**
 * Mask hardcoded secret literals in config source while leaving the structure
 * (keys, env() calls, comments) intact so it stays useful to the AI. Targets:
 *  - the fallback-default literal of `env('KEY', 'default')`
 *  - string literals assigned to a secret-looking property
 *  - the inline password in a credentialed URL (`scheme://user:pass@host`)
 */
const SECRET_WORDS = '(?:secret|password|passwd|token|credential|(?:api|access|private|signing|encryption|app|client)[_-]?key|client[_-]?secret)'

export function redactSecrets(source: string): string {
  const MASK = '***redacted***'

  // env('KEY', 'fallback') — mask the fallback default, but only when the env
  // KEY name itself looks secret-y (so non-secret defaults like an APP_NAME or
  // a default port stay visible to the assistant).
  let out = source.replace(
    /(\benv\s*\(\s*['"]([^'"]+)['"]\s*,\s*)(['"])[^'"]*\3/g,
    (m: string, pre: string, key: string, q: string) =>
      new RegExp(SECRET_WORDS, 'i').test(key) ? `${pre}${q}${MASK}${q}` : m,
  )

  // A secret-looking property assigned a string literal:
  //   secretKey: '...', api_key = "...", password: '...', clientSecret: `...`
  out = out.replace(
    new RegExp(`\\b([A-Za-z_]*${SECRET_WORDS}[A-Za-z_]*)(\\s*[:=]\\s*)(['"\`])[^'"\`]*\\3`, 'gi'),
    (_m: string, key: string, sep: string, q: string) => `${key}${sep}${q}${MASK}${q}`,
  )

  // A password embedded in a credentialed URL literal: scheme://user:PASS@host
  out = out.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^:@\s'"]+:)[^@\s'"]+@/gi,
    (_m: string, prefix: string) => `${prefix}${MASK}@`,
  )

  return out
}

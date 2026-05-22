import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { readFileSafe, fileExists } from './_fs.js'

/**
 * Minimal `.env` parser — covers `KEY=value`, `KEY="value"`, comments, blanks.
 * Doesn't expand `${VAR}` references; we only need to check declared keys.
 */
function parseEnvText(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s+|\s+$/g, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out.set(key, value)
  }
  return out
}

registerDoctorCheck({
  id:       'env:dotenv-loadable',
  category: 'env',
  title:    '.env file',
  run(): DoctorResult {
    if (!fileExists('.env')) {
      const exampleHint = fileExists('.env.example')
        ? 'Run `cp .env.example .env` and fill in the secrets'
        : 'Create a .env file with your config (APP_KEY, AUTH_SECRET, etc.)'
      return { status: 'error', message: 'missing', fix: exampleHint }
    }
    const text = readFileSafe('.env')
    if (text === null) {
      return { status: 'error', message: 'present but unreadable', fix: 'Check file permissions on .env' }
    }
    const parsed = parseEnvText(text)
    return { status: 'ok', message: `parses (${parsed.size} keys)` }
  },
})

/**
 * APP_KEY is consumed by session signing, encryption, and signed URLs.
 * Determine whether the user's app actually wires any of those providers,
 * so APP_KEY=missing surfaces as a hard error for apps that need it and a
 * soft warn for apps that don't (e.g. demo / API-only playgrounds).
 *
 * Fails closed: if we can't read providers.ts, assume session IS in use.
 */
function appUsesAppKey(): boolean {
  const text = readFileSafe('bootstrap/providers.ts')
  if (text === null) return true  // unknown → strict
  // Auto-discovery path: defaultProviders() loads SessionProvider when @rudderjs/session is installed.
  if (/\bdefaultProviders\s*\(/.test(text)) return true
  // Manual composition: look for explicit session / auth / passport references.
  return /(@rudderjs\/(session|auth|passport)|(?:Session|Auth|Passport)Provider)\b/.test(text)
}

registerDoctorCheck({
  id:       'env:app-key',
  category: 'env',
  title:    'APP_KEY',
  run(): DoctorResult {
    const v = process.env['APP_KEY']
    if (!v) {
      if (!appUsesAppKey()) {
        return {
          status:  'warn',
          message: 'unset — no session/auth providers detected, not required for this app',
          fix:     'No action needed. Add APP_KEY to .env later if you wire @rudderjs/session, @rudderjs/auth, or signed URLs.',
        }
      }
      return {
        status:  'error',
        message: 'unset',
        fix:     'Generate a 32-byte base64 key (e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`) and put it in .env',
      }
    }
    // APP_KEY can be raw or base64-encoded. Accept either form, validate decoded length.
    let decodedLen: number
    try {
      decodedLen = Buffer.from(v, 'base64').length
    } catch {
      decodedLen = Buffer.byteLength(v)
    }
    if (decodedLen < 32) {
      return {
        status:  'warn',
        message: `present but only ${decodedLen} bytes — needs ≥ 32 for AES-256`,
        fix:     'Generate a fresh 32-byte key with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`',
      }
    }
    return { status: 'ok', message: `set, ${decodedLen} bytes` }
  },
})

registerDoctorCheck({
  id:       'env:app-env',
  category: 'env',
  title:    'APP_ENV',
  run(): DoctorResult {
    const v = process.env['APP_ENV'] ?? process.env['NODE_ENV']
    if (!v) {
      return {
        status:  'warn',
        message: 'unset — defaults to "production" in many adapters',
        fix:     'Add `APP_ENV=local` (or `dev`/`staging`/`production`) to .env',
      }
    }
    const known = ['local', 'dev', 'development', 'test', 'staging', 'production']
    if (!known.includes(v)) {
      return {
        status:  'warn',
        message: `non-standard value "${v}"`,
        fix:     `Use one of: ${known.join(', ')}`,
      }
    }
    return { status: 'ok', message: v }
  },
})

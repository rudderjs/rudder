// Doctor checks contributed by @rudderjs/hash.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

const KNOWN_DRIVERS = ['bcrypt', 'argon2'] as const

registerDoctorCheck({
  id:       'hash:driver',
  category: 'auth',
  title:    'Hash driver',
  run(): DoctorResult {
    // Heuristic-only — we read config/hash.ts as text and look for a
    // `driver:` literal. Importing the config module would require a booted
    // app + Env, which fast-path doctor must avoid.
    const candidates = ['config/hash.ts', 'config/hash.js', 'config/hash.mjs']
    let text: string | null = null
    for (const rel of candidates) {
      try {
        text = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
        break
      } catch { /* keep trying */ }
    }
    if (text === null) {
      return { status: 'ok', message: 'no config/hash.ts — uses default driver (bcrypt)' }
    }
    // Look for `driver: 'bcrypt'` / `driver: "argon2"` / `Env.get('HASH_DRIVER', 'bcrypt')`
    const literalMatch = /driver\s*:\s*['"]([^'"]+)['"]/.exec(text)
    const envFallback  = /HASH_DRIVER['"]?\s*,\s*['"]([^'"]+)['"]/.exec(text)
    const declared = literalMatch?.[1] ?? envFallback?.[1]
    if (!declared) {
      return { status: 'ok', message: 'config/hash.ts present, driver not statically inferable — skip' }
    }
    if (!(KNOWN_DRIVERS as readonly string[]).includes(declared)) {
      return {
        status:  'error',
        message: `unknown driver "${declared}" — supported: ${KNOWN_DRIVERS.join(', ')}`,
        fix:     `Set config/hash.ts driver to one of: ${KNOWN_DRIVERS.join(', ')}`,
      }
    }
    // If the driver requires an extra package (argon2), warn if it's not resolvable
    if (declared === 'argon2') {
      const argonResolvable = (() => {
        try {
          fs.statSync(path.join(process.cwd(), 'node_modules', 'argon2', 'package.json'))
          return true
        } catch { return false }
      })()
      if (!argonResolvable) {
        return {
          status:  'error',
          message: 'driver "argon2" but `argon2` npm package not installed',
          fix:     'pnpm add argon2',
        }
      }
    }
    return { status: 'ok', message: `${declared}` }
  },
})

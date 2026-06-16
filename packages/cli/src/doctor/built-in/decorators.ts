import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { readFileSafe } from './_fs.js'

/**
 * Decorator + DI setup preflight checks. RudderJS leans on TypeScript decorators
 * (`@Injectable`, routing) and `reflect-metadata` for the DI container, so a
 * misconfigured entry point or tsconfig breaks DI/routing with cryptic
 * runtime errors that surface far from the cause. These fast-path checks catch
 * the two most common setup cliffs before the app ever boots.
 */

// ─── reflect-metadata import ──────────────────────────────────────

registerDoctorCheck({
  id:       'structure:reflect-metadata',
  category: 'structure',
  title:    'reflect-metadata import',
  run(): DoctorResult {
    const app = readFileSafe('bootstrap/app.ts')
    // A missing bootstrap/app.ts is the concern of `structure:bootstrap-app`;
    // don't double-report it here.
    if (app === null) return { status: 'ok', message: 'no bootstrap/app.ts (skipped)' }
    if (/import\s+['"]reflect-metadata['"]/.test(app)) {
      return { status: 'ok', message: 'imported in bootstrap/app.ts' }
    }
    return {
      status:  'error',
      message: 'bootstrap/app.ts does not import reflect-metadata — DI and decorators will fail at runtime',
      fix:     "Add `import 'reflect-metadata'` as the first line of bootstrap/app.ts",
    }
  },
})

// ─── tsconfig decorator flags ──────────────────────────────────────

interface TsConfig {
  extends?:         string | string[]
  compilerOptions?: {
    experimentalDecorators?: boolean
    emitDecoratorMetadata?:  boolean
  }
}

/**
 * Parse JSONC (tsconfig allows `//` + block comments and trailing commas). Tries
 * strict JSON first, then a tolerant strip. Returns null on failure.
 */
function parseJsonc<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch { /* fall through to tolerant parse */ }
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1')      // line comments (not after a `:` in a URL-ish value)
      .replace(/,(\s*[}\]])/g, '$1')           // trailing commas
    return JSON.parse(stripped) as T
  } catch {
    return null
  }
}

/** Resolve an `extends` target to an absolute tsconfig file path, or null. */
function resolveExtends(spec: string, fromDir: string): string | null {
  // Relative path — TypeScript appends `.json` if no extension is present.
  if (spec.startsWith('.') || path.isAbsolute(spec)) {
    const base = path.isAbsolute(spec) ? spec : path.join(fromDir, spec)
    const cand = base.endsWith('.json') ? base : `${base}.json`
    return fs.existsSync(cand) ? cand : null
  }
  // Package specifier (e.g. `@tsconfig/node22/tsconfig.json` or `some-pkg`).
  // Resolve from node_modules at the app cwd; fall back to `<pkg>/tsconfig.json`.
  const inModules = path.join(process.cwd(), 'node_modules', spec)
  for (const cand of [inModules, `${inModules}.json`, path.join(inModules, 'tsconfig.json')]) {
    try { if (fs.statSync(cand).isFile()) return cand } catch { /* keep trying */ }
  }
  return null
}

/**
 * Walk the `extends` chain (bounded) and merge `compilerOptions`, child over
 * parent — the same precedence TypeScript uses. Returns the two decorator flags
 * plus whether the chain resolved fully (so an unresolvable `extends` downgrades
 * a hard error to a soft "couldn't verify").
 */
function resolveDecoratorFlags(startFile: string): {
  experimentalDecorators?: boolean | undefined
  emitDecoratorMetadata?:  boolean | undefined
  fullyResolved:           boolean
} {
  let experimentalDecorators: boolean | undefined
  let emitDecoratorMetadata:  boolean | undefined
  let fullyResolved = true

  const visit = (absFile: string, depth: number): void => {
    if (depth > 10) { fullyResolved = false; return }
    let text: string | null = null
    try { text = fs.readFileSync(absFile, 'utf-8') } catch { fullyResolved = false; return }
    const cfg = parseJsonc<TsConfig>(text)
    if (!cfg) { fullyResolved = false; return }

    // Parents first (so this file's options override them).
    const parents = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends]
    for (const p of parents) {
      const resolved = resolveExtends(p, path.dirname(absFile))
      if (resolved === null) { fullyResolved = false; continue }
      visit(resolved, depth + 1)
    }

    const co = cfg.compilerOptions
    if (co?.experimentalDecorators !== undefined) experimentalDecorators = co.experimentalDecorators
    if (co?.emitDecoratorMetadata  !== undefined) emitDecoratorMetadata  = co.emitDecoratorMetadata
  }

  visit(startFile, 0)
  return { experimentalDecorators, emitDecoratorMetadata, fullyResolved }
}

registerDoctorCheck({
  id:       'structure:tsconfig-decorators',
  category: 'structure',
  title:    'tsconfig decorator flags',
  run(): DoctorResult {
    const tsconfigPath = path.join(process.cwd(), 'tsconfig.json')
    if (!fs.existsSync(tsconfigPath)) {
      return { status: 'ok', message: 'no tsconfig.json (skipped)' }
    }
    const { experimentalDecorators, emitDecoratorMetadata, fullyResolved } = resolveDecoratorFlags(tsconfigPath)
    const both = experimentalDecorators === true && emitDecoratorMetadata === true
    if (both) {
      return { status: 'ok', message: 'experimentalDecorators + emitDecoratorMetadata enabled' }
    }

    const missing = [
      experimentalDecorators === true ? null : 'experimentalDecorators',
      emitDecoratorMetadata  === true ? null : 'emitDecoratorMetadata',
    ].filter((x): x is string => x !== null)

    // If the extends chain couldn't be fully read, don't assert a hard failure —
    // the flag may live in an unreadable base config.
    if (!fullyResolved) {
      return {
        status:  'warn',
        message: `could not verify ${missing.join(' + ')} (an extended tsconfig was unreadable)`,
        fix:     'Ensure experimentalDecorators and emitDecoratorMetadata are true in tsconfig.json (or a base it extends)',
      }
    }
    return {
      status:  'error',
      message: `${missing.join(' + ')} not enabled — decorators and DI metadata will not emit`,
      fix:     'Set "experimentalDecorators": true and "emitDecoratorMetadata": true under compilerOptions in tsconfig.json',
    }
  },
})

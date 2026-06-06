import fs from 'node:fs'
import path from 'node:path'
import { parseEnvKeys, syncEnvFromDisk } from '../env-scanner.js'

/**
 * Register the `env:sync` command with the rudder CLI. Two jobs in one pass:
 *
 * 1. Regenerates `.rudder/types/env.d.ts` from `.env.example` (same emit the
 *    Vite env scanner does on dev/build) — typed `Env.get()` keys without
 *    booting anything.
 * 2. Diffs `.env` against `.env.example`: keys the example declares but your
 *    `.env` is missing are flagged (the classic "teammate added a key, your
 *    checkout silently breaks" gap). `--fix` appends them with their example
 *    values — and copies `.env.example` wholesale when `.env` doesn't exist.
 *
 * Keys that exist ONLY in `.env` are reported but never touched — deletions
 * are destructive and machine-local keys are legitimate.
 *
 * Skip-boot, like `routes:sync` / `view:sync`.
 */
export function registerEnvSyncCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('env:sync', async (args: string[]) => {
    const jsonFlag = args.includes('--json')
    const fixFlag  = args.includes('--fix')
    const cwd = process.cwd()

    try {
      const result = syncEnvFromDisk(cwd)

      if (!result.exampleExists) {
        if (jsonFlag) {
          console.log(JSON.stringify({ exampleExists: false }, null, 2))
        } else {
          console.log('No .env.example found — nothing to scan.')
        }
        return
      }

      // ── Diff .env against the example contract ──
      const examplePath = path.join(cwd, '.env.example')
      const envPath     = path.join(cwd, '.env')
      const exampleKeys = parseEnvKeys(fs.readFileSync(examplePath, 'utf8'))

      let envText: string | null = null
      try {
        envText = fs.readFileSync(envPath, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      const envKeySet = new Set(envText === null ? [] : parseEnvKeys(envText).map(k => k.key))
      const missing   = exampleKeys.filter(k => !envKeySet.has(k.key))
      const extra     = envText === null
        ? []
        : parseEnvKeys(envText).map(k => k.key).filter(k => !exampleKeys.some(e => e.key === k))

      let fixed = false
      if (fixFlag && envText === null) {
        // No .env at all — start from the example wholesale (comments included).
        fs.copyFileSync(examplePath, envPath)
        fixed = true
      } else if (fixFlag && missing.length > 0) {
        const block = `\n# Added by \`rudder env:sync --fix\` — values are the .env.example defaults\n`
          + missing.map(k => k.line).join('\n') + '\n'
        fs.appendFileSync(envPath, block)
        fixed = true
      }

      if (jsonFlag) {
        console.log(JSON.stringify({
          exampleExists: true,
          keyCount:      result.keyCount,
          envExists:     envText !== null,
          missing:       missing.map(k => k.key),
          extra,
          fixed,
        }, null, 2))
        return
      }

      console.log(`✓ Scanned ${result.keyCount} key${result.keyCount === 1 ? '' : 's'} → .rudder/types/env.d.ts`)

      if (envText === null) {
        if (fixed) {
          console.log('✓ No .env found — created it from .env.example. Fill in the real values.')
        } else {
          console.log('! No .env found. Run with --fix to create it from .env.example.')
        }
        return
      }

      if (missing.length === 0) {
        console.log('✓ .env declares every key in .env.example')
      } else if (fixed) {
        console.log(`✓ Appended ${missing.length} missing key${missing.length === 1 ? '' : 's'} to .env (example values — fill in the real ones):`)
        for (const k of missing) console.log(`    ${k.key}`)
      } else {
        console.log(`! .env is missing ${missing.length} key${missing.length === 1 ? '' : 's'} declared in .env.example (run with --fix to append):`)
        for (const k of missing) console.log(`    ${k.key}`)
      }

      if (extra.length > 0) {
        console.log(`  ${extra.length} key${extra.length === 1 ? '' : 's'} in .env but not in .env.example (machine-local? consider declaring): ${extra.join(', ')}`)
      }
    } catch (err) {
      console.error('env:sync failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }).description('Regenerate typed Env keys from .env.example + diff .env against it (--fix appends missing keys)')
}

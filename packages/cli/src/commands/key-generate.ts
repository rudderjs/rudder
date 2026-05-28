import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Command } from 'commander'

// ── Key generation ────────────────────────────────────────────

/**
 * Generate a random 32-byte AES-256-compatible key, base64-encoded with the
 * `base64:` prefix that `@rudderjs/crypt`'s `parseKey()` recognises. Kept
 * here (rather than importing `Crypt.generateKey()` from `@rudderjs/crypt`)
 * because the CLI is universal — `key:generate` must work in apps that
 * haven't installed `@rudderjs/crypt` yet (which is exactly when you'd
 * generate your first key).
 */
function generateKey(): string {
  return `base64:${randomBytes(32).toString('base64')}`
}

// ── .env editor ──────────────────────────────────────────────

/**
 * Result of attempting to write `APP_KEY=<value>` into `.env`. Mirrors
 * Laravel's `key:generate` output shape — the CLI surfaces a different
 * message for each kind so the user knows whether a file was created,
 * a line was added, or an existing line was replaced.
 */
type EnvWriteOutcome =
  | { kind: 'wrote-new' }      // .env didn't exist; we created it
  | { kind: 'appended' }       // .env existed but had no APP_KEY line
  | { kind: 'replaced' }       // existing APP_KEY line rewritten
  | { kind: 'skipped' }        // APP_KEY already set, --force NOT passed

/**
 * Atomically write `content` to `path`. Writes to a sibling temp file first,
 * then renames into place — `rename(2)` is atomic on POSIX (and on Windows for
 * paths on the same volume). Prevents partial reads if the process crashes
 * mid-write, and sidesteps `js/file-system-race` CodeQL warnings that fire on
 * any sequence like `existsSync → writeFileSync` or `readFileSync →
 * writeFileSync`.
 *
 * `wx` flag on the temp file refuses to clobber a leftover from a prior
 * crash; cleanup-on-failure removes the temp so a botched run never leaves
 * stray files.
 */
function atomicWriteFile(target: string, content: string): void {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, content, { flag: 'wx' })
    renameSync(tmp, target)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* never mind — temp may not exist */ }
    throw err
  }
}

/**
 * Idempotent set of `APP_KEY=<value>` in an `.env` file. Preserves all other
 * lines, comments, and ordering. Returns the outcome so the caller can render
 * a meaningful message.
 *
 * The match is anchored on a line starting with `APP_KEY=` (Laravel's shape).
 * Lines that are commented out (`# APP_KEY=...`) or use a different name
 * (`APP_KEYS=...`) are not touched.
 *
 * Race-free: a single `readFileSync` decides every branch, and the write is
 * atomic via temp-file + rename. Branching on whether the file exists comes
 * from the read's error code (ENOENT) — no `existsSync` + `writeFileSync`
 * TOCTOU window.
 */
export function setEnvKey(envPath: string, value: string, force: boolean): EnvWriteOutcome {
  let text: string | null
  try {
    text = readFileSync(envPath, 'utf8')
  } catch (err) {
    // ENOENT is the only "expected" failure here; anything else is a real
    // I/O error and surfaces to the caller.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    text = null
  }

  if (text === null) {
    atomicWriteFile(envPath, `APP_KEY=${value}\n`)
    return { kind: 'wrote-new' }
  }

  const lines = text.split('\n')
  const idx = lines.findIndex((l) => /^APP_KEY=/.test(l))
  if (idx === -1) {
    // No line — append. Preserve trailing newline if present.
    const sep = text.endsWith('\n') ? '' : '\n'
    atomicWriteFile(envPath, `${text}${sep}APP_KEY=${value}\n`)
    return { kind: 'appended' }
  }
  // Found an APP_KEY line. Replace only when --force, OR when the existing
  // value is empty (`APP_KEY=` / `APP_KEY=""`) — empty is what fresh
  // scaffolded `.env` files ship with.
  const existingValue = lines[idx]!.slice('APP_KEY='.length).trim().replace(/^["']|["']$/g, '')
  if (existingValue && !force) {
    return { kind: 'skipped' }
  }
  lines[idx] = `APP_KEY=${value}`
  atomicWriteFile(envPath, lines.join('\n'))
  return { kind: 'replaced' }
}

// ── Output ────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false
const green = (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s
const yel   = (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s
const dim   = (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s
const bold  = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s

// ── Command ───────────────────────────────────────────────────

interface KeyGenerateOptions {
  show?:  boolean
  force?: boolean
  path?:  string
}

export function keyGenerateCommand(program: Command): void {
  program
    .command('key:generate')
    .description('Generate a 32-byte APP_KEY and write it to .env (Laravel parity)')
    .option('--show',         'print the generated key to stdout; do not modify .env')
    .option('--force',        'overwrite an existing APP_KEY line in .env')
    .option('--path <file>',  'path to the .env file', '.env')
    .action((opts: KeyGenerateOptions) => {
      const key = generateKey()

      if (opts.show) {
        // Pipe-friendly — only the key on stdout, hint on stderr.
        console.log(key)
        process.stderr.write(dim(`\n  Add this to .env as APP_KEY=<value>\n`))
        return
      }

      const envPath = path.resolve(process.cwd(), opts.path ?? '.env')
      const result  = setEnvKey(envPath, key, opts.force ?? false)
      const rel     = path.relative(process.cwd(), envPath) || envPath

      switch (result.kind) {
        case 'wrote-new':
          console.log(`\n  ${green('✓')} Created ${bold(rel)} with a fresh APP_KEY.`)
          break
        case 'appended':
          console.log(`\n  ${green('✓')} Added ${bold('APP_KEY')} to ${bold(rel)}.`)
          break
        case 'replaced':
          console.log(`\n  ${green('✓')} Replaced ${bold('APP_KEY')} in ${bold(rel)}.`)
          break
        case 'skipped':
          console.log(`\n  ${yel('!')} ${bold(rel)} already has an ${bold('APP_KEY')} set.`)
          console.log(dim(`  Pass ${bold('--force')} to overwrite, or ${bold('--show')} to print a new key without modifying ${rel}.`))
          process.exit(1)
      }
    })
}

/** @internal — exposed for unit tests */
export const _internal = {
  generateKey,
  setEnvKey,
}

/**
 * `rudder tinker` — interactive REPL with the app booted.
 *
 * Laravel's `php artisan tinker` equivalent. Drops into a Node REPL after the
 * full app boot completes; pre-populates the REPL context with the DI
 * container accessor, `Route` alias, `rudder` registry, and every model
 * discovered under `app/Models/`. Top-level await works (Node 16+ REPL).
 *
 * The cli sets `RUDDERJS_TINKER=1` before booting so providers can short-
 * circuit anything that would otherwise open a network listener / poll loop.
 * Most providers don't need this — Prisma + BullMQ + ORM clients are already
 * lazy-construct, and network listeners only start on `app.listen()`/`app.serve()`
 * which tinker never calls — but the sentinel exists for providers that DO
 * actively poll/connect on `boot()` (horizon's WorkerCollector is the
 * canonical example; same pattern as `RUDDERJS_QUEUE_WORKER`).
 */
import type { Command as CommanderCommand } from 'commander'
import * as nodeRepl from 'node:repl'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
}

/**
 * Globals injected into the REPL context. Each entry is dynamic-imported so
 * tinker degrades gracefully when a peer isn't installed (router is an
 * optional peer of cli, for instance).
 */
interface TinkerContext {
  [name: string]: unknown
}

export function tinkerCommand(program: CommanderCommand): void {
  program
    .command('tinker')
    .description('Interactive REPL with the app booted (Laravel artisan tinker equivalent)')
    .option('--no-history', 'Disable persistent ~/.rudder-tinker-history')
    .option('--no-banner',  'Suppress the welcome banner (useful for piping or scripting)')
    .action(async (opts: { history?: boolean; banner?: boolean }) => {
      const showBanner  = opts.banner  !== false
      const useHistory  = opts.history !== false

      if (showBanner) {
        const env = process.env['APP_ENV'] ?? 'local'
        console.log('')
        console.log(`  ${C.bold('RudderJS Tinker')} ${C.dim(`— node ${process.version}, env=${env}`)}`)
        console.log('')
      }

      // Build the REPL's seed context — app's DI accessor, Route alias, model
      // classes from app/Models/, plus a few facades when their providers booted.
      const context = await buildTinkerContext()

      if (showBanner) {
        const names = Object.keys(context).sort()
        if (names.length > 0) {
          console.log(`  ${C.dim('Available:')}`)
          // Wrap so a long list doesn't blow past the terminal width
          const chunks: string[][] = [[]]
          let len = 0
          for (const n of names) {
            if (len + n.length + 2 > 72) { chunks.push([]); len = 0 }
            chunks[chunks.length - 1]!.push(n)
            len += n.length + 2
          }
          for (const row of chunks) {
            console.log(`    ${row.map(n => C.cyan(n)).join(C.dim(', '))}`)
          }
        }
        console.log('')
        console.log(`  ${C.dim('Top-level await is enabled. Type')} ${C.green('.help')} ${C.dim('for commands.')}`)
        console.log('')
      }

      const replServer = nodeRepl.start({
        prompt:    '> ',
        useColors: true,
        terminal:  process.stdout.isTTY,
        // The default `eval` already supports top-level await on Node 16+.
        // useGlobal:false (the default) keeps user assignments scoped to
        // the REPL's context, not leaking into globalThis.
      })

      // History persistence — best-effort. setupHistory is callback-style;
      // we ignore errors so a read-only home dir doesn't break tinker.
      if (useHistory) {
        const historyPath = path.join(os.homedir(), '.rudder-tinker-history')
        replServer.setupHistory(historyPath, () => { /* swallow */ })
      }

      // Seed the context — assign AFTER setupHistory so the REPL's own
      // `_` placeholder, `module`, `require`, etc are already in place
      // (defineCommand uses some of those internally).
      Object.assign(replServer.context, context)

      // .boot — reload providers + remerge models. Useful after editing a
      // model class without restarting tinker. Best-effort: doesn't try to
      // tear down provider connections; existing references in user-defined
      // variables still point at the old instances.
      replServer.defineCommand('boot', {
        help: 'Re-boot the app to pick up code changes (does not invalidate user-held references)',
        action: async () => {
          try {
            const fresh = await buildTinkerContext()
            Object.assign(replServer.context, fresh)
            console.log(C.dim(`  reloaded ${Object.keys(fresh).length} context entries`))
          } catch (err) {
            console.error(C.dim('  reload failed: ') + (err instanceof Error ? err.message : String(err)))
          }
          replServer.displayPrompt()
        },
      })

      // Block until the user exits — `.exit` or Ctrl-D.
      await new Promise<void>((resolve) => {
        replServer.on('exit', () => resolve())
      })
      process.exit(0)
    })
}

/**
 * Build the seed object for the REPL context. Each entry is dynamic-imported
 * so a missing optional peer (router, mcp, …) doesn't crash tinker — the
 * key just doesn't show up in the welcome list.
 *
 * Exported (@internal) for unit testing — the REPL loop itself opens stdin
 * and is hard to drive in-process; the context builder is the testable piece.
 */
export async function buildTinkerContext(modelsDir?: string): Promise<TinkerContext> {
  const ctx: TinkerContext = {}

  // `app()` — DI container accessor (re-exported from @rudderjs/core)
  await tryAdd(ctx, '@rudderjs/core', (mod) => {
    if (typeof (mod as Record<string, unknown>)['app'] === 'function') {
      ctx['app']    = (mod as { app: unknown }).app
      ctx['config'] = (mod as { config: unknown }).config
    }
    if (typeof (mod as Record<string, unknown>)['rudder'] !== 'undefined') {
      ctx['rudder'] = (mod as { rudder: unknown }).rudder
      ctx['Rudder'] = (mod as { Rudder: unknown }).Rudder
    }
  })

  // `Route` + `route()` URL generator + `Url` signed-URL helper
  await tryAdd(ctx, '@rudderjs/router', (mod) => {
    const m = mod as Record<string, unknown>
    if (m['Route'])             ctx['Route']             = m['Route']
    if (m['route'])             ctx['route']             = m['route']
    if (m['Url'])               ctx['Url']               = m['Url']
  })

  // Models from app/Models/ — every named export that looks like a class,
  // plus the default export keyed by the filename.
  await loadModels(ctx, modelsDir ?? path.join(process.cwd(), 'app', 'Models'))

  return ctx
}

/**
 * Dynamic-import a package; if it resolves, hand it to the visitor. Swallow
 * any error (peer not installed, broken subpath, etc) — tinker should keep
 * going even if a peer fails to load.
 */
async function tryAdd(
  ctx: TinkerContext,
  pkg: string,
  visit: (mod: unknown) => void,
): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ pkg)
    visit(mod)
  } catch {
    /* peer not installed */
  }
}

/**
 * Walk `app/Models/` (single level — nested model dirs are rare and add
 * disambiguation cost). Each file is dynamic-imported; named exports that
 * start with an uppercase letter are registered by name, and the default
 * export is registered under the filename stem.
 *
 * A broken model file (syntax error, missing import) emits one warning and
 * doesn't take down the REPL — tinker stays usable for the user's other
 * models. Same forgiving spirit as `pnpm rudder providers:discover`.
 */
export async function loadModels(ctx: TinkerContext, modelsDir: string): Promise<void> {
  if (!fs.existsSync(modelsDir)) return

  for (const file of fs.readdirSync(modelsDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js') && !file.endsWith('.mts') && !file.endsWith('.mjs')) continue
    const abs   = path.join(modelsDir, file)
    const stem  = path.basename(file, path.extname(file))
    // On Windows, Node's ESM loader refuses `import('C:\\path\\file.js')` —
    // absolute paths must be file:// URLs. macOS/Linux accept either form;
    // pathToFileURL is the portable normalizer (same pattern as the doctor's
    // load-package-checks.ts).
    const href = pathToFileURL(abs).href
    try {
      const mod = await import(/* @vite-ignore */ href) as Record<string, unknown>
      let registered = 0
      for (const [key, val] of Object.entries(mod)) {
        if (key === 'default') {
          ctx[stem] = val
          registered++
        } else if (key[0] && key[0] === key[0].toUpperCase() && typeof val === 'function') {
          // Uppercase-starting function exports (i.e. classes)
          ctx[key] = val
          registered++
        }
      }
      // Files that exported nothing usable — silently skip (helpers, types, …).
      void registered
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`${C.dim('[tinker]')} could not load ${file}: ${msg.split('\n')[0]}`)
    }
  }
}

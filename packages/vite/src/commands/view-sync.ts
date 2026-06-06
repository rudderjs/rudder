import { syncViewsFromDisk } from '../views-scanner.js'

/**
 * Register the `view:sync` command with the rudder CLI.
 *
 * Regenerates `pages/__view/` (Vike stubs, `+config.ts`) and the typed-view
 * registry (`.rudder/types/views.d.ts`) from `app/Views/` without booting
 * the app or starting Vite. Useful when:
 *
 * - Running `tsc` in CI before any Vite step (typecheck-before-build order)
 * - On a fresh clone / scaffolded app, before the first `pnpm dev` or `pnpm build`
 * - After manually clearing `pages/__view/` (e.g. mistaking it for stale junk)
 * - Any time `view('id', ...)` fails to type-check against a freshly-added `Props`
 *   export and you want a focused regeneration rather than booting the dev server
 *
 * Idempotent — read-compare-then-write across every generated file. Safe to
 * call repeatedly in CI scripts.
 */
export function registerViewSyncCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('view:sync', async (args: string[]) => {
    const jsonFlag = args.includes('--json')

    try {
      const result = syncViewsFromDisk()

      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      if (!result.viewsRootExists) {
        console.log('  No app/Views/ directory found — nothing to sync.')
        return
      }

      const summary = `  Synced ${result.viewCount} view${result.viewCount === 1 ? '' : 's'} (${result.typedCount} typed) — framework: ${result.framework}`
      console.log(summary)
      console.log('  Wrote pages/__view/{+config.ts,<id>/+Page.*} + .rudder/types/views.d.ts')
    } catch (err) {
      if (jsonFlag) {
        console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2))
      } else {
        console.error('  view:sync failed:', err instanceof Error ? err.message : String(err))
      }
      process.exit(1)
    }
  }).description('Regenerate pages/__view/ from app/Views/ without starting Vite')
}

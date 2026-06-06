import { syncRoutesFromDisk } from '../routes-scanner.js'

/**
 * Register the `routes:sync` command with the rudder CLI.
 *
 * Regenerates `routes/__registry.d.ts` from `routes/*.ts` without booting
 * the app or starting Vite. Useful when:
 *
 * - Running `tsc` in CI before any Vite step (typecheck-before-build order)
 * - On a fresh clone / scaffolded app, before the first `pnpm dev` or `pnpm build`
 * - After adding a `.name('foo')` chain in `routes/web.ts` and you want
 *   `route('foo', ...)` to type-check without restarting the dev server
 *
 * Idempotent — `writeIfChanged` skips the write when content is unchanged.
 */
export function registerRoutesSyncCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('routes:sync', async (args: string[]) => {
    const jsonFlag = args.includes('--json')

    try {
      const result = syncRoutesFromDisk()

      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      if (!result.routesDirExists) {
        console.log('No routes/ directory found — nothing to scan.')
        return
      }

      console.log(`✓ Scanned ${result.routeCount} named route${result.routeCount === 1 ? '' : 's'} → routes/__registry.d.ts`)
    } catch (err) {
      console.error('routes:sync failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }).description('Regenerate the RouteRegistry augmentation from routes/*.ts')
}

import { syncConfigFromDisk } from '../config-scanner.js'

/**
 * Register the `config:sync` command with the rudder CLI. Regenerates
 * `.rudder/types/config.d.ts` from the app's `config/index.ts` barrel (same
 * emit the Vite config scanner does on dev/build) — typed `config()` keys
 * without booting anything.
 *
 * Skip-boot, like `routes:sync` / `env:sync`.
 */
export function registerConfigSyncCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('config:sync', async (args: string[]) => {
    const jsonFlag = args.includes('--json')
    const cwd = process.cwd()

    try {
      const result = syncConfigFromDisk(cwd)

      if (!result.barrelExists) {
        if (jsonFlag) {
          console.log(JSON.stringify({ barrelExists: false }, null, 2))
        } else {
          console.log('No config/index.ts found — nothing to scan.')
        }
        return
      }

      if (jsonFlag) {
        console.log(JSON.stringify({ barrelExists: true }, null, 2))
        return
      }

      console.log('✓ Regenerated typed config keys → .rudder/types/config.d.ts')
    } catch (err) {
      console.error('config:sync failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }).description('Regenerate typed config() keys from config/index.ts')
}

// Doctor checks contributed by @rudderjs/orm's native engine.
//
// Loaded via the `@rudderjs/orm/doctor` subpath — a side-effect import that
// registers checks with the shared registry in `@rudderjs/console`. Node-only;
// never reached from the client-safe main entry.
//
// Mirrors `@rudderjs/orm-prisma/doctor`'s `db-connect`: a `--deep` (needsBoot)
// check that reuses the native driver the app already opened during boot —
// cached on `globalThis` by `NativeAdapter.make()` — rather than opening a
// second connection. Inert (skips) when the app isn't using the native engine.

import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

// Structural view of the native adapter's globalThis driver cache (see
// `src/native/adapter.ts` — `__rudderjs_native_client__`). Read structurally so
// this module doesn't import the node-only adapter/driver at doctor-load time.
interface CachedNativeClient {
  signature: string
  driver:    { execute(sql: string, bindings: readonly unknown[]): Promise<unknown[]> }
}
const NATIVE_CLIENT_CACHE_KEY = '__rudderjs_native_client__'

registerDoctorCheck({
  id:        'orm-native:db-connect',
  category:  'runtime',
  title:     'Native engine database connection',
  needsBoot: true,
  async run(): Promise<DoctorResult> {
    const cached = (globalThis as Record<string, unknown>)[NATIVE_CLIENT_CACHE_KEY] as
      | CachedNativeClient
      | undefined
    if (!cached?.driver) {
      // No native driver opened during boot → this app doesn't use the native
      // engine (or boot failed). Not an error: prisma/drizzle apps land here.
      return {
        status:  'ok',
        message: 'native engine not in use — skip (set `engine: \'native\'` in config/database.ts to enable)',
      }
    }
    const t0 = performance.now()
    try {
      await cached.driver.execute('SELECT 1', [])
      const ms = Math.round(performance.now() - t0)
      const where = cached.signature.split('::').slice(1).join('::') || ':memory:'
      return { status: 'ok', message: `connected in ${ms}ms (${where})` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        status:  'error',
        message: msg.split('\n').slice(0, 3).join(' ').trim().slice(0, 200),
        fix:     'Check the native connection URL in config/database.ts is a writable SQLite path, and that `better-sqlite3` is installed.',
        detail:  msg,
      }
    }
    // NB: no close() — `driver` is the app's shared connection (reused across HMR re-boots).
  },
})

// ─── Blueprint-intent replay guard ─────────────────────────
//
// While `collectBlueprintIntent` replays applied migration files to recover
// their declared column types (see `schema/intent-replay.ts`), a migration's
// `up()` may contain RUNTIME statements alongside its `Schema` calls — a
// `DB.statement(...)` data backfill, a Model write. Re-executing those on
// every `schema:types` run would corrupt data, so the replay window arms this
// guard and `instrumentExecutor` (the single funnel every NativeAdapter
// statement flows through — write executor, read replicas, and transaction
// scopes alike) refuses with {@link NativeOrmError} `NATIVE_INTENT_REPLAY`.
// The replayer catches the throw per-migration and simply skips the rest of
// that migration's intent — types fall back to the introspected storage
// mapping, never to a wrong answer.
//
// Module-level state is safe here: the replay runs serially inside a CLI
// process (`migrate` / `schema:types`), where nothing else is querying. The
// orm shim (`@rudderjs/orm/native`) re-exports this same module instance, so
// both import paths share one flag.

import { NativeOrmError } from './errors.js'

let active = false

/** Whether a blueprint-intent replay is currently in progress. */
export function isIntentReplayActive(): boolean {
  return active
}

/** Throw the replay-window error a runtime statement must surface. */
export function refuseIntentReplayStatement(): never {
  throw new NativeOrmError(
    'NATIVE_INTENT_REPLAY',
    `[RudderJS ORM native] A database statement was attempted during blueprint-intent replay. ` +
    `Migration up() bodies are re-run (against a recording schema only) to recover declared column ` +
    `types for schema:types — runtime statements (DB.*, Model queries) are never re-executed. ` +
    `This migration's remaining intent is skipped; its columns keep their introspected types.`,
  )
}

/** Run `fn` with the replay guard armed, disarming afterwards even on throw. */
export async function withIntentReplayGuard<T>(fn: () => Promise<T>): Promise<T> {
  active = true
  try {
    return await fn()
  } finally {
    active = false
  }
}

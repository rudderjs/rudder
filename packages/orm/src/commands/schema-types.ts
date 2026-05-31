// ─── schema:types command (GATE 7-types) ──────────────────
//
// `rudder schema:types` regenerates `app/Models/__schema/registry.d.ts` from the
// live native schema on demand — the same generation that runs automatically
// after a native `migrate` / `migrate:fresh` / `migrate:refresh` / rollback.
// Native-engine only: prisma/drizzle apps already produce a typed client
// (`db:generate`), so this is a friendly no-op there.
//
// Like `migrate*`, it skips the CLI's standard app boot and boots the native
// engine on demand (via the injected `bootApp`) to reach the configured adapter
// + introspect its connection. The runner + model-cast collection live in
// `migrate.ts` alongside the other native runners; this module is just the CLI
// wiring, exported from the `@rudderjs/orm/commands/schema-types` subpath.

import { CliError } from '@rudderjs/console'
import { detectORM, resolveNativeAdapter, runNativeSchemaTypes } from './migrate.js'

/**
 * Register the `schema:types` command with the rudder CLI. Pass `bootApp` so the
 * native engine (no external CLI) can boot on demand to reach its adapter.
 */
export function registerSchemaTypesCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
  opts: { bootApp?: () => Promise<void> } = {},
): void {
  const cwd = process.cwd()

  rudder.command('schema:types', async () => {
    const native = await resolveNativeAdapter(cwd, opts.bootApp)
    if (native) {
      console.log('  ORM: native')
      await runNativeSchemaTypes(native, cwd)
      return
    }

    // prisma/drizzle generate their own typed client — point at db:generate.
    const orm = detectORM(cwd)
    if (orm === 'prisma') {
      console.log('  schema:types targets the native engine. Prisma generates its own typed client — run `rudder db:generate`.')
      return
    }
    if (orm === 'drizzle') {
      console.log('  schema:types targets the native engine. Drizzle\'s TypeScript schema is already the source of its types — no generation step needed.')
      return
    }

    // Native app but the adapter couldn't be resolved (no bootApp injected, or
    // the default connection isn't engine: 'native').
    throw new CliError(
      'schema:types could not resolve the native engine. Ensure the default connection sets `engine: \'native\'` and the app boots.',
      1,
    )
  }).description('Generate app/Models/__schema/registry.d.ts from the live native schema')
}

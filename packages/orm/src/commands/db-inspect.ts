// ─── db:show / db:table commands ──────────────────────────
//
// Laravel's `db:show` / `db:table` analogs over the native engine's inspection
// layer (`@rudderjs/database` `inspectDatabase`/`inspectTable`). Native-engine
// only: prisma/drizzle ship their own inspection tooling (`prisma studio`,
// `drizzle-kit studio`), so those get a friendly pointer instead.
//
// Like `schema:types`, the commands resolve the configured native adapter via
// `resolveNativeAdapter` (booting the app on demand through the injected
// `bootApp` when it hasn't booted yet). This module is just the CLI wiring,
// exported from the `@rudderjs/orm/commands/db-inspect` subpath.

import { CliError } from '@rudderjs/console'
import type { DatabaseInfo, TableInfo } from '@rudderjs/database/native'
import { detectORM, resolveNativeAdapter } from './migrate.js'

/** The two adapter methods this module needs — `resolveNativeAdapter` returns
 *  the generic `OrmAdapter`, so capability is duck-checked at the call site. */
interface InspectCapable {
  inspectDatabase(opts?: { counts?: boolean; views?: boolean }): Promise<DatabaseInfo>
  inspectTable(table: string): Promise<TableInfo | null>
}

const DIALECT_LABELS: Record<DatabaseInfo['dialect'], string> = {
  sqlite: 'SQLite',
  pg:     'PostgreSQL',
  mysql:  'MySQL',
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim  = (s: string) => `\x1b[2m${s}\x1b[0m`

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit  = -1
  do { value /= 1024; unit++ } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(1)} ${units[unit]}`
}

/** Resolve the native adapter or throw/print the right non-native guidance.
 *  Returns null when a friendly pointer was printed (prisma/drizzle). */
async function resolveInspectable(
  command: string,
  cwd: string,
  bootApp?: () => Promise<void>,
): Promise<InspectCapable | null> {
  const native = await resolveNativeAdapter(cwd, bootApp)
  if (native && typeof (native as Partial<InspectCapable>).inspectDatabase === 'function') {
    return native as unknown as InspectCapable
  }

  const orm = detectORM(cwd)
  if (orm === 'prisma') {
    console.log(`  ${command} targets the native engine. Prisma ships its own inspector — run \`prisma studio\`.`)
    return null
  }
  if (orm === 'drizzle') {
    console.log(`  ${command} targets the native engine. Drizzle ships its own inspector — run \`drizzle-kit studio\`.`)
    return null
  }
  throw new CliError(
    `${command} could not resolve the native engine. Ensure the default connection sets \`engine: 'native'\` and the app boots.`,
    1,
  )
}

// ─── Rendering ─────────────────────────────────────────────

function printDatabase(info: DatabaseInfo, counts: boolean): void {
  const label = DIALECT_LABELS[info.dialect]
  console.log()
  console.log(`  ${bold(`${label}${info.version ? ` ${info.version}` : ''}`)}${info.database ? `  ${dim(info.database)}` : ''}`)
  console.log(`  Tables: ${info.tables.length}`)

  if (info.tables.length > 0) {
    const nameWidth = Math.max(5, ...info.tables.map((t) => t.name.length))
    console.log()
    console.log(`  ${'TABLE'.padEnd(nameWidth)}  ${'SIZE'.padEnd(9)}${counts ? '  ROWS' : ''}`)
    console.log(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(9)}${counts ? `  ${'─'.repeat(6)}` : ''}`)
    for (const t of info.tables) {
      console.log(`  ${t.name.padEnd(nameWidth)}  ${formatBytes(t.sizeBytes).padEnd(9)}${counts ? `  ${t.rows ?? 0}` : ''}`)
    }
  }

  if (info.views !== undefined) {
    console.log()
    if (info.views.length === 0) {
      console.log(`  ${dim('No views.')}`)
    } else {
      console.log(`  ${bold('Views')}`)
      for (const v of info.views) console.log(`  ${v}`)
    }
  }
  console.log()
}

function printTable(info: TableInfo): void {
  console.log()
  console.log(`  ${bold(info.name)}  ${dim(`${info.rows} ${info.rows === 1 ? 'row' : 'rows'}${info.sizeBytes !== null ? ` · ${formatBytes(info.sizeBytes)}` : ''}`)}`)

  const colWidth  = Math.max(6, ...info.columns.map((c) => c.name.length))
  const typeWidth = Math.max(4, ...info.columns.map((c) => c.type.length))
  console.log()
  console.log(`  ${'COLUMN'.padEnd(colWidth)}  ${'TYPE'.padEnd(typeWidth)}  ${'NULLABLE'.padEnd(8)}  DEFAULT`)
  console.log(`  ${'─'.repeat(colWidth)}  ${'─'.repeat(typeWidth)}  ${'─'.repeat(8)}  ${'─'.repeat(7)}`)
  for (const c of info.columns) {
    console.log(`  ${c.name.padEnd(colWidth)}  ${c.type.padEnd(typeWidth)}  ${(c.notNull ? 'no' : 'yes').padEnd(8)}  ${c.dflt ?? '—'}`)
  }

  if (info.indexes.length > 0) {
    const ixWidth   = Math.max(5, ...info.indexes.map((ix) => ix.name.length))
    const ixColWidth = Math.max(7, ...info.indexes.map((ix) => ix.columns.join(', ').length))
    console.log()
    console.log(`  ${'INDEX'.padEnd(ixWidth)}  ${'COLUMNS'.padEnd(ixColWidth)}  ATTRIBUTES`)
    console.log(`  ${'─'.repeat(ixWidth)}  ${'─'.repeat(ixColWidth)}  ${'─'.repeat(10)}`)
    for (const ix of info.indexes) {
      const attrs = [ix.primary ? 'primary' : null, ix.unique ? 'unique' : null].filter(Boolean).join(', ')
      console.log(`  ${ix.name.padEnd(ixWidth)}  ${ix.columns.join(', ').padEnd(ixColWidth)}  ${attrs || dim('—')}`)
    }
  }

  if (info.foreignKeys.length > 0) {
    console.log()
    console.log(`  ${bold('Foreign Keys')}`)
    for (const fk of info.foreignKeys) {
      const target  = `${fk.foreignTable}${fk.foreignColumns.length > 0 ? ` (${fk.foreignColumns.join(', ')})` : ''}`
      const actions = (fk.onUpdate || fk.onDelete)
        ? dim(`  on update ${fk.onUpdate ?? '—'} · on delete ${fk.onDelete ?? '—'}`)
        : ''
      console.log(`  ${fk.name ? `${fk.name}: ` : ''}${fk.columns.join(', ')} → ${target}${actions}`)
    }
  }
  console.log()
}

// ─── Command Registration ─────────────────────────────────

/**
 * Register the `db:show` and `db:table` commands with the rudder CLI. Pass
 * `bootApp` so the native engine (no external CLI) can boot on demand to
 * reach its adapter.
 *
 * `db:show [--counts] [--views] [--json]` — database overview.
 * `db:table <name> [--json]` — one table's columns, indexes, and foreign keys.
 */
export function registerDbInspectCommands(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
  opts: { bootApp?: () => Promise<void> } = {},
): void {
  const cwd = process.cwd()

  rudder.command('db:show', async (args: string[]) => {
    const native = await resolveInspectable('db:show', cwd, opts.bootApp)
    if (!native) return

    const counts = args.includes('--counts')
    const views  = args.includes('--views')
    const info   = await native.inspectDatabase({ counts, views })

    if (args.includes('--json')) {
      console.log(JSON.stringify(info, null, 2))
      return
    }
    printDatabase(info, counts)
  }).description('Display database overview — tables, sizes, row counts (native engine)')

  rudder.command('db:table', async (args: string[]) => {
    const table = args.find((a) => !a.startsWith('-'))
    if (!table) throw new CliError('Usage: rudder db:table <name>', 1)

    const native = await resolveInspectable('db:table', cwd, opts.bootApp)
    if (!native) return

    const info = await native.inspectTable(table)
    if (info === null) {
      const all = await native.inspectDatabase()
      const hint = all.tables.length > 0 ? ` Available tables: ${all.tables.map((t) => t.name).join(', ')}` : ''
      throw new CliError(`Table '${table}' doesn't exist.${hint}`, 1)
    }

    if (args.includes('--json')) {
      console.log(JSON.stringify(info, null, 2))
      return
    }
    printTable(info)
  }).description("Display a table's columns, indexes, and foreign keys (native engine)")
}

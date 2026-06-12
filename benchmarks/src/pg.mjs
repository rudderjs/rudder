// ─── Postgres admin helpers ──────────────────────────────────────────────────
// CREATE / DROP / TEMPLATE-clone DATABASE for the Postgres engine, run over a
// short-lived porsager connection to the maintenance database. These are the
// Postgres analogs of the SQLite suite's file operations: a per-size seed DB
// (one .sqlite file → one database), and TEMPLATE-clone for write-bench scratch
// (copyFileSync → CREATE DATABASE … TEMPLATE, a fast file-level clone).

import postgres from 'postgres'
import { pgAdminUrl } from './engine.mjs'

// Database identifiers are framework-controlled (rudder_bench_<size>,
// scratch_<tag>), never user input — but validate anyway since they're
// interpolated raw (you cannot bind an identifier).
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`[pg] unsafe database identifier: ${name}`)
  return name
}

/** Open a max:1 admin connection, run `fn`, always close it. */
async function withAdmin(fn) {
  const sql = postgres(pgAdminUrl(), { max: 1, onnotice: () => {} })
  try {
    return await fn(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Terminate every other backend connected to `db` (so it can be dropped or
 *  used as a CREATE DATABASE template, both of which need it connection-free). */
async function terminate(sql, db) {
  await sql.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${db}' AND pid <> pg_backend_pid()`,
  )
}

/** Drop a database if it exists (terminating any stragglers first). */
export async function dropDb(name) {
  ident(name)
  await withAdmin(async (sql) => {
    await terminate(sql, name)
    await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`)
  })
}

/** Drop + recreate an empty database. */
export async function createFreshDb(name) {
  ident(name)
  await withAdmin(async (sql) => {
    await terminate(sql, name)
    await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`)
    await sql.unsafe(`CREATE DATABASE ${name}`)
  })
}

/** CREATE DATABASE `dst` TEMPLATE `src` — a fast, file-level copy of a seeded
 *  database. `src` must be connection-free at clone time (terminate ensures it). */
export async function cloneDb(src, dst) {
  ident(src)
  ident(dst)
  await withAdmin(async (sql) => {
    await terminate(sql, dst)
    await sql.unsafe(`DROP DATABASE IF EXISTS ${dst}`)
    await terminate(sql, src)
    await sql.unsafe(`CREATE DATABASE ${dst} TEMPLATE ${src}`)
  })
}

/** Does database `name` exist? (setup-readiness check for the runner.) */
export async function dbExists(name) {
  ident(name)
  return withAdmin(async (sql) => {
    const rows = await sql.unsafe(`SELECT 1 FROM pg_database WHERE datname = '${name}'`)
    return rows.length > 0
  })
}

/** The Postgres server version string (for the results provenance block). */
export async function serverVersion() {
  return withAdmin(async (sql) => {
    const rows = await sql.unsafe(`SHOW server_version`)
    return rows[0]?.server_version ?? 'unknown'
  })
}

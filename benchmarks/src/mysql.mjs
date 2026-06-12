// ─── MySQL admin helpers ─────────────────────────────────────────────────────
// CREATE / DROP / clone DATABASE for the MySQL engine, run over a short-lived
// mysql2 connection that carries NO default database (so CREATE/DROP DATABASE
// always work). These are the MySQL analogs of the SQLite suite's file ops and
// mirror pg.mjs's API exactly — createFreshDb / cloneDb / dropDb / dbExists /
// serverVersion — so setup/scratch/run can pick `IS_PG ? pg : mysql` and call a
// uniform surface.
//
// MySQL has no `CREATE DATABASE … TEMPLATE` (Postgres) and no file to copy
// (SQLite), so cloneDb recreates the schema with `CREATE TABLE … LIKE` and
// bulk-copies rows with `INSERT … SELECT` across databases on the same server —
// the fastest server-side clone MySQL offers. The schema carries no FOREIGN KEY
// constraints (see schema.mjs), so table copy order is irrelevant.

import { mysqlAdminUrl } from './engine.mjs'

// The tables cloneDb copies — the full set owned by schema.mjs (MYSQL_DDL).
const TABLES = ['users', 'posts', 'comments', 'tags', 'post_tags']

// Database identifiers are framework-controlled (rudder_bench_<size>,
// scratch_<tag>), never user input — but validate anyway since they're
// interpolated raw into backtick-quoted identifiers (you cannot bind one).
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`[mysql] unsafe database identifier: ${name}`)
  return name
}

/** Open a short-lived admin connection (no default DB), run `fn`, always close it. */
async function withAdmin(fn) {
  const mysql = await import('mysql2/promise')
  const conn = await mysql.createConnection({ uri: mysqlAdminUrl() })
  try {
    return await fn(conn)
  } finally {
    await conn.end()
  }
}

/** Drop a database if it exists. */
export async function dropDb(name) {
  ident(name)
  await withAdmin((conn) => conn.query(`DROP DATABASE IF EXISTS \`${name}\``))
}

/** Drop + recreate an empty database. */
export async function createFreshDb(name) {
  ident(name)
  await withAdmin(async (conn) => {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``)
    await conn.query(`CREATE DATABASE \`${name}\``)
  })
}

/** Clone `src` → fresh `dst`: recreate every table's structure (`LIKE`) then
 *  bulk-copy its rows (`INSERT … SELECT`). The MySQL analog of Postgres's
 *  CREATE DATABASE … TEMPLATE / the SQLite file copy, for write-bench scratch. */
export async function cloneDb(src, dst) {
  ident(src)
  ident(dst)
  await withAdmin(async (conn) => {
    await conn.query(`DROP DATABASE IF EXISTS \`${dst}\``)
    await conn.query(`CREATE DATABASE \`${dst}\``)
    for (const t of TABLES) {
      await conn.query(`CREATE TABLE \`${dst}\`.\`${t}\` LIKE \`${src}\`.\`${t}\``)
      await conn.query(`INSERT INTO \`${dst}\`.\`${t}\` SELECT * FROM \`${src}\`.\`${t}\``)
    }
  })
}

/** Does database `name` exist? (setup-readiness check for the runner.) */
export async function dbExists(name) {
  ident(name)
  return withAdmin(async (conn) => {
    const [rows] = await conn.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = ?',
      [name],
    )
    return rows.length > 0
  })
}

/** The MySQL server version string (for the results provenance block). */
export async function serverVersion() {
  return withAdmin(async (conn) => {
    const [rows] = await conn.query('SELECT VERSION() AS v')
    return rows[0]?.v ?? 'unknown'
  })
}

// ─── Engine selection (sqlite | postgres | mysql) ───────────────────────────
// One bench process runs ONE engine, fixed at launch via BENCH_ENGINE (default
// sqlite, so the original SQLite suite is unchanged). Every engine-divergent bit
// — DDL, seeding, the "target" a contender connects to, scratch isolation —
// flows through this module + pg.mjs / mysql.mjs, so the contenders' op logic
// stays shared and the result-parity gate proves every engine does identical work.

const RAW = process.env['BENCH_ENGINE']
export const ENGINE = RAW === 'postgres' ? 'postgres' : RAW === 'mysql' ? 'mysql' : 'sqlite'
export const IS_PG = ENGINE === 'postgres'
export const IS_MYSQL = ENGINE === 'mysql'
export const IS_SQLITE = ENGINE === 'sqlite'
// Postgres + MySQL are both client/server engines reached over a socket — they
// share the "create/clone/drop a per-size database" admin shape (pg.mjs / mysql.mjs
// expose the same API) that SQLite handles with plain file operations.
export const IS_SERVER = IS_PG || IS_MYSQL

const withDb = (base, db) => {
  const q = base.indexOf('?')
  return q === -1 ? `${base}/${db}` : `${base.slice(0, q)}/${db}${base.slice(q)}`
}

// Normalize a base URL down to scheme://auth@host (+ query): strip any database
// path so the suite owns the per-size naming (rudder_bench_<size>). Query string
// (ssl, etc.) is preserved.
function baseOf(raw) {
  const u = new URL(raw)
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : ''
  return `${u.protocol}//${auth}${u.host}${u.search}`
}

// ── Postgres ─────────────────────────────────────────────────────────────────
// Base URL — host/port/user only; the per-size database name is appended by
// pgSizeUrl(). Default = the local Postgres.app bench cluster (see the
// bench-postgres-local-install note).
export const pgBaseUrl = () => baseOf(process.env['BENCH_PG_URL'] ?? 'postgres://localhost:5433')
// The maintenance database every cluster ships with — used for CREATE/DROP
// DATABASE (you cannot drop the database you're connected to).
export const pgAdminUrl = () => withDb(pgBaseUrl(), 'postgres')
export const pgSizeDb = (size) => `rudder_bench_${size}`
export const pgSizeUrl = (size) => withDb(pgBaseUrl(), pgSizeDb(size))

// ── MySQL ─────────────────────────────────────────────────────────────────--
// Base URL — host/port/user only; the per-size database is appended by
// mysqlSizeUrl(). Default = a local server on the standard port; override with
// BENCH_MYSQL_URL (e.g. mysql://root:pwd@127.0.0.1:3306). The admin connection
// carries NO database — MySQL runs CREATE/DROP DATABASE without a current schema,
// so there's no "can't drop the db you're in" restriction to dance around.
export const mysqlBaseUrl = () => baseOf(process.env['BENCH_MYSQL_URL'] ?? 'mysql://root@127.0.0.1:3306')
export const mysqlAdminUrl = () => mysqlBaseUrl()
export const mysqlSizeDb = (size) => `rudder_bench_${size}`
export const mysqlSizeUrl = (size) => withDb(mysqlBaseUrl(), mysqlSizeDb(size))

// ── Unified server-engine helpers ────────────────────────────────────────────
// The active server engine's per-size database name / connection URL / base URL.
// Callers (setup/scratch/run) pair these with the matching admin module
// (`IS_PG ? pg : mysql`) so engine selection lives here, not scattered downstream.
export const serverSizeDb = (size) => (IS_MYSQL ? mysqlSizeDb(size) : pgSizeDb(size))
export const serverSizeUrl = (size) => (IS_MYSQL ? mysqlSizeUrl(size) : pgSizeUrl(size))
export const serverBaseUrl = () => (IS_MYSQL ? mysqlBaseUrl() : pgBaseUrl())

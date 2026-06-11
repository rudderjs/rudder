// ─── Engine selection (sqlite | postgres) ────────────────────────────────────
// One bench process runs ONE engine, fixed at launch via BENCH_ENGINE (default
// sqlite, so the original SQLite suite is unchanged). Every engine-divergent bit
// — DDL, seeding, the "target" a contender connects to, scratch isolation —
// flows through this module + pg.mjs, so the contenders' op logic stays shared
// and the result-parity gate proves both engines do identical work.

export const ENGINE = process.env['BENCH_ENGINE'] === 'postgres' ? 'postgres' : 'sqlite'
export const IS_PG = ENGINE === 'postgres'

// Base Postgres URL — host/port/user only; the per-size database name is
// appended by pgSizeUrl(). Any database path in BENCH_PG_URL is stripped so we
// own the naming (rudder_bench_<size>). Default = the local Postgres.app bench
// cluster (see the bench-postgres-local-install note). Query string (ssl, etc.)
// is preserved.
export function pgBaseUrl() {
  const raw = process.env['BENCH_PG_URL'] ?? 'postgres://localhost:5433'
  const u = new URL(raw)
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : ''
  return `${u.protocol}//${auth}${u.host}${u.search}`
}

const withDb = (base, db) => {
  const q = base.indexOf('?')
  return q === -1 ? `${base}/${db}` : `${base.slice(0, q)}/${db}${base.slice(q)}`
}

// The maintenance database every cluster ships with — used for CREATE/DROP
// DATABASE (you cannot drop the database you're connected to).
export const pgAdminUrl = () => withDb(pgBaseUrl(), 'postgres')

export const pgSizeDb = (size) => `rudder_bench_${size}`
export const pgSizeUrl = (size) => withDb(pgBaseUrl(), pgSizeDb(size))

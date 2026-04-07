import { randomUUID } from 'node:crypto'
import type {
  PulseAggregate, PulseEntry, PulseStorage,
  MetricType, EntryType, EntryListOptions,
} from './types.js'

// ─── Helpers ───────────────────────────────────────────────

/** Round a date down to the start of its 1-minute bucket */
function bucketStart(date: Date): Date {
  const d = new Date(date)
  d.setSeconds(0, 0)
  return d
}

function bucketKey(bucket: Date, type: MetricType, key: string | null): string {
  return `${bucket.toISOString()}|${type}|${key ?? ''}`
}

// ─── Memory Storage ────────────────────────────────────────

export class MemoryStorage implements PulseStorage {
  private readonly aggregates_: Map<string, PulseAggregate> = new Map()
  private readonly entries_: PulseEntry[] = []
  private readonly maxEntries: number

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries
  }

  record(type: MetricType, value: number, key?: string | null): void {
    const bucket = bucketStart(new Date())
    const bk     = bucketKey(bucket, type, key ?? null)

    const existing = this.aggregates_.get(bk)
    if (existing) {
      existing.count += 1
      existing.sum   += value
      if (existing.min === null || value < existing.min) existing.min = value
      if (existing.max === null || value > existing.max) existing.max = value
    } else {
      this.aggregates_.set(bk, {
        id:        randomUUID(),
        bucket,
        type,
        key:       key ?? null,
        count:     1,
        sum:       value,
        min:       value,
        max:       value,
        createdAt: new Date(),
      })
    }
  }

  storeEntry(type: EntryType, content: Record<string, unknown>): void {
    this.entries_.unshift({
      id:        randomUUID(),
      type,
      content,
      createdAt: new Date(),
    })
    if (this.entries_.length > this.maxEntries) {
      this.entries_.length = this.maxEntries
    }
  }

  aggregates(type: MetricType, since: Date, key?: string | null): PulseAggregate[] {
    const sinceTs = since.getTime()
    const result: PulseAggregate[] = []
    for (const agg of this.aggregates_.values()) {
      if (agg.type !== type) continue
      if (agg.bucket.getTime() < sinceTs) continue
      if (key !== undefined && key !== null && agg.key !== key) continue
      result.push(agg)
    }
    return result.sort((a, b) => a.bucket.getTime() - b.bucket.getTime())
  }

  entries(type: EntryType, options?: EntryListOptions): PulseEntry[] {
    let result = this.entries_.filter(e => e.type === type)
    if (options?.search) {
      const s = options.search.toLowerCase()
      result = result.filter(e => JSON.stringify(e.content).toLowerCase().includes(s))
    }
    const page    = options?.page    ?? 1
    const perPage = options?.perPage ?? 50
    const start   = (page - 1) * perPage
    return result.slice(start, start + perPage)
  }

  overview(since: Date): PulseAggregate[] {
    const sinceTs = since.getTime()
    const result: PulseAggregate[] = []
    for (const agg of this.aggregates_.values()) {
      if (agg.bucket.getTime() < sinceTs) continue
      result.push(agg)
    }
    return result.sort((a, b) => a.bucket.getTime() - b.bucket.getTime())
  }

  pruneOlderThan(date: Date): void {
    const ts = date.getTime()
    for (const [key, agg] of this.aggregates_.entries()) {
      if (agg.bucket.getTime() < ts) this.aggregates_.delete(key)
    }
    const idx = this.entries_.findIndex(e => e.createdAt.getTime() < ts)
    if (idx !== -1) this.entries_.length = idx
  }
}

// ─── SQLite Storage ────────────────────────────────────────

export class SqliteStorage implements PulseStorage {
  private db: import('better-sqlite3').Database | null = null

  constructor(private readonly dbPath: string) {}

  private getDb(): import('better-sqlite3').Database {
    if (!this.db) {
      const Database = (globalThis as Record<string, unknown>).__betterSqlite3 as typeof import('better-sqlite3') | undefined
      if (!Database) {
        throw new Error(
          '[RudderJS Pulse] better-sqlite3 is required for SQLite storage. Run: pnpm add better-sqlite3',
        )
      }
      this.db = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(this.dbPath)
      this.migrate()
    }
    return this.db
  }

  private migrate(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS pulse_aggregates (
        id         TEXT PRIMARY KEY,
        bucket     TEXT NOT NULL,
        type       TEXT NOT NULL,
        key        TEXT,
        count      INTEGER NOT NULL DEFAULT 0,
        sum        REAL NOT NULL DEFAULT 0,
        min        REAL,
        max        REAL,
        created_at TEXT NOT NULL,
        UNIQUE(bucket, type, key)
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_agg_type_bucket ON pulse_aggregates(type, bucket);

      CREATE TABLE IF NOT EXISTS pulse_entries (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_entry_type_created ON pulse_entries(type, created_at);
    `)
  }

  record(type: MetricType, value: number, key?: string | null): void {
    const bucket = bucketStart(new Date()).toISOString()
    const k      = key ?? null

    const existing = this.getDb().prepare(
      'SELECT id, count, sum, min, max FROM pulse_aggregates WHERE bucket = ? AND type = ? AND key IS ?',
    ).get(bucket, type, k) as { id: string; count: number; sum: number; min: number | null; max: number | null } | undefined

    if (existing) {
      this.getDb().prepare(
        `UPDATE pulse_aggregates SET count = count + 1, sum = sum + ?,
         min = CASE WHEN min IS NULL OR ? < min THEN ? ELSE min END,
         max = CASE WHEN max IS NULL OR ? > max THEN ? ELSE max END
         WHERE id = ?`,
      ).run(value, value, value, value, value, existing.id)
    } else {
      this.getDb().prepare(
        `INSERT INTO pulse_aggregates (id, bucket, type, key, count, sum, min, max, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).run(randomUUID(), bucket, type, k, value, value, value, new Date().toISOString())
    }
  }

  storeEntry(type: EntryType, content: Record<string, unknown>): void {
    this.getDb().prepare(
      'INSERT INTO pulse_entries (id, type, content, created_at) VALUES (?, ?, ?, ?)',
    ).run(randomUUID(), type, JSON.stringify(content), new Date().toISOString())
  }

  aggregates(type: MetricType, since: Date, key?: string | null): PulseAggregate[] {
    let sql = 'SELECT * FROM pulse_aggregates WHERE type = ? AND bucket >= ?'
    const params: unknown[] = [type, since.toISOString()]
    if (key !== undefined && key !== null) {
      sql += ' AND key = ?'
      params.push(key)
    }
    sql += ' ORDER BY bucket ASC'
    const rows = this.getDb().prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(r => this.aggFromRow(r))
  }

  entries(type: EntryType, options?: EntryListOptions): PulseEntry[] {
    const page    = options?.page    ?? 1
    const perPage = options?.perPage ?? 50
    const offset  = (page - 1) * perPage

    let sql    = 'SELECT * FROM pulse_entries WHERE type = ?'
    const params: unknown[] = [type]

    if (options?.search) {
      sql += ' AND content LIKE ?'
      params.push(`%${options.search}%`)
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(perPage, offset)

    const rows = this.getDb().prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(r => ({
      id:        r['id'] as string,
      type:      r['type'] as EntryType,
      content:   JSON.parse(r['content'] as string) as Record<string, unknown>,
      createdAt: new Date(r['created_at'] as string),
    }))
  }

  overview(since: Date): PulseAggregate[] {
    const rows = this.getDb().prepare(
      'SELECT * FROM pulse_aggregates WHERE bucket >= ? ORDER BY bucket ASC',
    ).all(since.toISOString()) as Record<string, unknown>[]
    return rows.map(r => this.aggFromRow(r))
  }

  pruneOlderThan(date: Date): void {
    const iso = date.toISOString()
    const db  = this.getDb()
    db.prepare('DELETE FROM pulse_aggregates WHERE bucket < ?').run(iso)
    db.prepare('DELETE FROM pulse_entries WHERE created_at < ?').run(iso)
  }

  private aggFromRow(r: Record<string, unknown>): PulseAggregate {
    return {
      id:        r['id'] as string,
      bucket:    new Date(r['bucket'] as string),
      type:      r['type'] as MetricType,
      key:       (r['key'] as string) || null,
      count:     r['count'] as number,
      sum:       r['sum'] as number,
      min:       (r['min'] as number) ?? null,
      max:       (r['max'] as number) ?? null,
      createdAt: new Date(r['created_at'] as string),
    }
  }
}

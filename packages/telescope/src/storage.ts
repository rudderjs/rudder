import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { TelescopeEntry, TelescopeStorage, ListOptions, EntryType } from './types.js'

const _g = globalThis as Record<string, unknown>
const _recKey = '__rudderjs_telescope_recording__'

function isRecording(): boolean {
  return (_g[_recKey] as boolean | undefined) ?? true
}

// ─── Helpers ───────────────────────────────────────────────

export function createEntry(
  type:    EntryType,
  content: Record<string, unknown>,
  options?: { batchId?: string; tags?: string[]; familyHash?: string },
): TelescopeEntry {
  return {
    id:         randomUUID(),
    batchId:    options?.batchId ?? null,
    type,
    content,
    tags:       options?.tags ?? [],
    familyHash: options?.familyHash ?? null,
    createdAt:  new Date(),
  }
}

// ─── Memory Storage ────────────────────────────────────────

export class MemoryStorage implements TelescopeStorage {
  private entries: TelescopeEntry[] = []

  constructor(private readonly maxEntries: number = 1000) {}

  store(entry: TelescopeEntry): void {
    if (!isRecording()) return
    this.entries.unshift(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries
    }
  }

  storeBatch(entries: TelescopeEntry[]): void {
    if (!isRecording()) return
    for (const entry of entries) this.store(entry)
  }

  list(options: ListOptions): TelescopeEntry[] {
    let result = this.entries

    if (options.type) {
      result = result.filter(e => e.type === options.type)
    }
    if (options.batchId) {
      const bId = options.batchId
      result = result.filter(e => e.batchId === bId)
    }
    if (options.tag) {
      const tag = options.tag
      result = result.filter(e => e.tags.includes(tag))
    }
    if (options.search) {
      const s = options.search.toLowerCase()
      result = result.filter(e =>
        JSON.stringify(e.content).toLowerCase().includes(s),
      )
    }

    const page    = options.page    ?? 1
    const perPage = options.perPage ?? 50
    const start   = (page - 1) * perPage
    return result.slice(start, start + perPage)
  }

  find(id: string): TelescopeEntry | null {
    return this.entries.find(e => e.id === id) ?? null
  }

  count(type?: EntryType): number {
    if (!type) return this.entries.length
    return this.entries.filter(e => e.type === type).length
  }

  prune(type?: EntryType): void {
    if (!type) {
      this.entries.length = 0
    } else {
      this.entries = this.entries.filter(e => e.type !== type)
    }
  }

  pruneOlderThan(date: Date): void {
    const ts = date.getTime()
    this.entries = this.entries.filter(e => e.createdAt.getTime() >= ts)
  }
}

// ─── SQLite Storage ────────────────────────────────────────

export class SqliteStorage implements TelescopeStorage {
  private db: import('better-sqlite3').Database | null = null

  constructor(private readonly dbPath: string) {}

  private getDb(): import('better-sqlite3').Database {
    if (!this.db) {
      // Load better-sqlite3 via createRequire so native bindings work under
      // ESM + Vite SSR. Allow consumers to pre-stash the module on globalThis
      // (e.g. when bundling) as an escape hatch.
      let Database = (globalThis as Record<string, unknown>).__betterSqlite3 as typeof import('better-sqlite3') | undefined
      if (!Database) {
        try {
          const req = createRequire(import.meta.url)
          Database = req('better-sqlite3') as typeof import('better-sqlite3')
        } catch (err) {
          throw new Error(
            '[RudderJS Telescope] better-sqlite3 is required for SQLite storage. Run: pnpm add better-sqlite3 ' +
            `(load error: ${err instanceof Error ? err.message : String(err)})`,
          )
        }
      }
      this.db = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(this.dbPath)
      this.migrate()
    }
    return this.db
  }

  private migrate(): void {
    const db = this.db!
    // WAL mode lets the dev server + CLI processes read/write the same file
    // concurrently without "database is locked" errors.
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS telescope_entries (
        id          TEXT PRIMARY KEY,
        batch_id    TEXT,
        type        TEXT NOT NULL,
        content     TEXT NOT NULL,
        tags        TEXT NOT NULL DEFAULT '[]',
        family_hash TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telescope_type_created ON telescope_entries(type, created_at);
      CREATE INDEX IF NOT EXISTS idx_telescope_batch ON telescope_entries(batch_id);
    `)
  }

  private toRow(entry: TelescopeEntry): Record<string, unknown> {
    return {
      id:          entry.id,
      batch_id:    entry.batchId,
      type:        entry.type,
      content:     JSON.stringify(entry.content),
      tags:        JSON.stringify(entry.tags),
      family_hash: entry.familyHash,
      created_at:  entry.createdAt.toISOString(),
    }
  }

  private fromRow(row: Record<string, unknown>): TelescopeEntry {
    return {
      id:         row['id'] as string,
      batchId:    (row['batch_id'] as string) || null,
      type:       row['type'] as EntryType,
      content:    JSON.parse(row['content'] as string) as Record<string, unknown>,
      tags:       JSON.parse(row['tags'] as string) as string[],
      familyHash: (row['family_hash'] as string) || null,
      createdAt:  new Date(row['created_at'] as string),
    }
  }

  store(entry: TelescopeEntry): void {
    if (!isRecording()) return
    const row = this.toRow(entry)
    this.getDb().prepare(
      `INSERT INTO telescope_entries (id, batch_id, type, content, tags, family_hash, created_at)
       VALUES (@id, @batch_id, @type, @content, @tags, @family_hash, @created_at)`,
    ).run(row)
  }

  storeBatch(entries: TelescopeEntry[]): void {
    if (!isRecording()) return
    const db   = this.getDb()
    const stmt = db.prepare(
      `INSERT INTO telescope_entries (id, batch_id, type, content, tags, family_hash, created_at)
       VALUES (@id, @batch_id, @type, @content, @tags, @family_hash, @created_at)`,
    )
    const tx = db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) stmt.run(row)
    })
    tx(entries.map(e => this.toRow(e)))
  }

  list(options: ListOptions): TelescopeEntry[] {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (options.type)    { conditions.push('type = @type');          params['type']     = options.type }
    if (options.batchId) { conditions.push('batch_id = @batchId');   params['batchId']  = options.batchId }
    if (options.tag)     { conditions.push('tags LIKE @tag');        params['tag']      = `%${options.tag}%` }
    if (options.search)  { conditions.push('content LIKE @search');  params['search']   = `%${options.search}%` }

    const where   = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const page    = options.page    ?? 1
    const perPage = options.perPage ?? 50
    const offset  = (page - 1) * perPage

    params['limit']  = perPage
    params['offset'] = offset

    const rows = this.getDb()
      .prepare(`SELECT * FROM telescope_entries ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Record<string, unknown>[]

    return rows.map(r => this.fromRow(r))
  }

  find(id: string): TelescopeEntry | null {
    const row = this.getDb()
      .prepare('SELECT * FROM telescope_entries WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    return row ? this.fromRow(row) : null
  }

  count(type?: EntryType): number {
    const sql = type
      ? 'SELECT COUNT(*) as cnt FROM telescope_entries WHERE type = ?'
      : 'SELECT COUNT(*) as cnt FROM telescope_entries'
    const row = this.getDb().prepare(sql).get(...(type ? [type] : [])) as { cnt: number }
    return row.cnt
  }

  prune(type?: EntryType): void {
    if (type) {
      this.getDb().prepare('DELETE FROM telescope_entries WHERE type = ?').run(type)
    } else {
      this.getDb().prepare('DELETE FROM telescope_entries').run()
    }
  }

  pruneOlderThan(date: Date): void {
    this.getDb().prepare('DELETE FROM telescope_entries WHERE created_at < ?').run(date.toISOString())
  }
}

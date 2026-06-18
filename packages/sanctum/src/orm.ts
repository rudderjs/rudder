// ─── ORM-backed Token Repository ──────────────────────────
//
// Durable, production-ready token storage for `@rudderjs/sanctum`, backed by
// `@rudderjs/orm`. The main entry ships only `MemoryTokenRepository` (an
// in-process stub for dev/testing) so apps that don't need persistence pull
// zero database dependencies; this subpath (`@rudderjs/sanctum/orm`) is the
// opt-in durable store. `@rudderjs/orm` is an OPTIONAL peer — installing it is
// only required when you import from here.
//
// Usage (bootstrap/providers.ts):
//   import { sanctum } from '@rudderjs/sanctum'
//   import { OrmTokenRepository } from '@rudderjs/sanctum/orm'
//   export default [auth(configs.auth), sanctum(configs.sanctum, new OrmTokenRepository()), ...]
//
// Migration (database/migrations/xxxx_create_personal_access_tokens_table.ts):
//   import { Migration, Schema } from '@rudderjs/orm/native'
//   export default class extends Migration {
//     async up() {
//       await Schema.create('personal_access_tokens', (t) => {
//         t.ulid('id').primary()
//         t.string('userId').index()
//         t.string('name')
//         t.string('token').unique()
//         t.text('abilities').nullable()
//         t.dateTime('lastUsedAt').nullable()
//         t.dateTime('expiresAt').nullable()
//         t.dateTime('createdAt').useCurrent()
//       })
//     }
//     async down() { await Schema.dropIfExists('personal_access_tokens') }
//   }

import { Model } from '@rudderjs/orm'
import type { PersonalAccessToken, TokenRepository } from './index.js'

// ─── Model ────────────────────────────────────────────────

/**
 * ORM model backing the durable Sanctum token store. It carries the SQL table
 * name + a string ULID primary key (`keyType = 'ulid'`), so the same model
 * runs unchanged on the native engine, Prisma, and Drizzle — mirroring the
 * `@rudderjs/passport` models. `abilities` is stored JSON-encoded in a text
 * column; the repository handles (de)serialization so the distinction between
 * `null` (all abilities) and `[]` (no abilities) survives the round-trip.
 */
export class PersonalAccessTokenModel extends Model {
  static override table = 'personal_access_tokens'
  static override keyType = 'ulid' as const

  // `token` is the SHA-256 hash, never the plain text. `createdAt` is stamped
  // by the migration default (`useCurrent()`) / the ORM's timestamp helper, so
  // it isn't fillable. `updatedAt` is intentionally absent — tokens are
  // immutable except for `lastUsedAt`, written via the bulk update path below.
  static override fillable = ['userId', 'name', 'token', 'abilities', 'lastUsedAt', 'expiresAt']

  /** `MassPrunable` — a single bulk delete per chunk; no per-row observers. */
  static pruneMode = 'mass' as const

  /**
   * `rudder model:prune` predicate — rows whose per-token `expiresAt` has
   * passed. Tokens relying on the global `config.expiration` carry no
   * `expiresAt` (their expiry is enforced at validation time only), so they're
   * deliberately left untouched here. Register the model
   * (`ModelRegistry.register(PersonalAccessTokenModel)`) for prune to find it.
   */
  static prunable() {
    return this.query().where('expiresAt', '<', new Date())
  }

  declare id:         string
  declare userId:     string
  declare name:       string
  declare token:      string
  declare abilities:  string | null   // JSON-encoded `string[]` or null
  declare lastUsedAt: Date | null
  declare expiresAt:  Date | null
  declare createdAt:  Date
}

// ─── Mapping helpers ──────────────────────────────────────

// `abilities` is a JSON text column. `null` means "all abilities", `[]` means
// "none" — keep them distinct (a corrupt/non-array payload degrades to null).
function parseAbilities(raw: unknown): string[] | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw as string[]
  if (typeof raw === 'string') {
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? (value as string[]) : null
    } catch {
      return null
    }
  }
  return null
}

// Date columns read back as ISO strings on the native engine (no cast on the
// model) but as `Date` objects on Prisma — accept either, plus a stray null.
function toDate(raw: unknown): Date | null {
  if (raw == null) return null
  if (raw instanceof Date) return raw
  const date = new Date(raw as string)
  return Number.isNaN(date.getTime()) ? null : date
}

// ─── Repository ───────────────────────────────────────────

/**
 * Durable `TokenRepository` backed by an ORM model. Drop-in replacement for
 * `MemoryTokenRepository` — pass an instance as the second argument to
 * `sanctum(config, repository)`. The model class is injectable (defaulting to
 * `PersonalAccessTokenModel`) so a different table name or connection can be
 * wired by subclassing the model.
 */
export class OrmTokenRepository implements TokenRepository {
  constructor(
    private readonly model: typeof PersonalAccessTokenModel = PersonalAccessTokenModel,
  ) {}

  async create(data: {
    userId:     string
    name:       string
    token:      string
    abilities?: string[] | null
    expiresAt?: Date | null
  }): Promise<PersonalAccessToken> {
    const row = await this.model.create({
      userId:    data.userId,
      name:      data.name,
      token:     data.token,
      abilities: data.abilities == null ? null : JSON.stringify(data.abilities),
      expiresAt: data.expiresAt ?? null,
    })
    return this.toToken(row as unknown as Record<string, unknown>)
  }

  async findByToken(hashedToken: string): Promise<PersonalAccessToken | null> {
    const row = await this.model.query().where('token', hashedToken).first()
    return row ? this.toToken(row as unknown as Record<string, unknown>) : null
  }

  async findByUserId(userId: string): Promise<PersonalAccessToken[]> {
    const rows = await this.model.query().where('userId', userId).get()
    return rows.map((row) => this.toToken(row as unknown as Record<string, unknown>))
  }

  async updateLastUsed(id: string, date: Date): Promise<void> {
    // Bulk update path: no observers and no fillable filter needed — this is a
    // hot per-request write of a single column, run on every authenticated
    // request, so we skip the read-modify-write of `Model.update()`.
    await this.model.query().where('id', id).updateAll({ lastUsedAt: date })
  }

  async delete(id: string): Promise<void> {
    await this.model.query().where('id', id).deleteAll()
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.model.query().where('userId', userId).deleteAll()
  }

  private toToken(raw: Record<string, unknown>): PersonalAccessToken {
    return {
      id:         String(raw['id']),
      userId:     String(raw['userId']),
      name:       String(raw['name']),
      token:      String(raw['token']),
      abilities:  parseAbilities(raw['abilities']),
      lastUsedAt: toDate(raw['lastUsedAt']),
      expiresAt:  toDate(raw['expiresAt']),
      createdAt:  toDate(raw['createdAt']) ?? new Date(),
    }
  }
}

// GATE 7-types — the Model.for<TName>() binding (consumption side).
//
// This is primarily a COMPILE-TIME contract: the `@ts-expect-error` markers and
// the typed assignments below only hold if `Model.for<'accounts'>()` actually
// resolves a model's instance type from the generated `SchemaRegistry`. If the
// binding regresses, the test BUILD (`tsc -p tsconfig.test.json`, run by
// `pnpm test`) fails before any assertion executes. The runtime `it()` blocks
// additionally prove `.for()` is a no-op (purely additive).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Model } from '../../index.js'

// Augment the registry exactly like the generated `.rudder/types/models.d.ts`
// would — one entry per migrated table. `email` is nullable; `active` is a
// boolean (a cast-refined column, as the generator would emit it).
declare module '../../index.js' {
  interface SchemaRegistry {
    accounts: {
      id:     number
      name:   string
      email:  string | null
      active: boolean
    }
  }
}

// (1) Bound model — ZERO hand-declared column fields.
class Account extends Model.for<'accounts'>() {
  static override table = 'accounts'
}

// (2) Loose model — no `.for()`, behaves exactly as before.
class Loose extends Model {
  static override table = 'loose'
}

// (3) Legacy model — hand-declared fields, no `.for()`. Must stay untouched.
class Legacy extends Model {
  id!:   number
  name!: string
}

// ── Compile-time proofs (no DB; never executed) ────────────
async function typeProofs(): Promise<void> {
  const a = await Account.find(1)
  if (a) {
    const id:     number         = a.id
    const name:   string         = a.name
    const email:  string | null  = a.email
    const active: boolean        = a.active
    void id; void name; void email; void active

    // @ts-expect-error — unknown column must fail tsc
    void a.doesNotExist
    // @ts-expect-error — wrong type must fail tsc
    const wrong: number = a.name
    void wrong

    // instance methods still resolve on the bound type
    await a.save()
  }

  // Query-builder chains are typed too (not just the direct finders).
  const chained = await Account.where('active', true).first()
  if (chained) {
    const cn: string = chained.name
    void cn
    // @ts-expect-error — chain result rejects unknown columns
    void chained.doesNotExist
  }

  const many = await Account.all()
  if (many[0]) { const mn: string = many[0].name; void mn }

  // create() is typed off the same shape.
  const created = await Account.create({ name: 'x', email: 'a@b.c' })
  const createdName: string = created.name
  void createdName
  // @ts-expect-error — unknown column on create must fail tsc
  await Account.create({ nope: 1 })

  // Legacy hand-declared fields survive (NOT collapsed to never).
  const g = await Legacy.find(1)
  if (g) {
    const gn: string = g.name
    const gi: number = g.id
    void gn; void gi
    await g.save()
    // @ts-expect-error — legacy still rejects unknown columns
    void g.bogusColumn
  }

  // Loose model: methods work; no known columns to read.
  const l = await Loose.find(1)
  if (l) {
    await l.save()
    // @ts-expect-error — loose model has no declared/known columns
    void l.whatever
  }
}
void typeProofs

// ── Runtime proofs: `.for()` is additive / a no-op ─────────
describe('Model.for<TName>() binding', () => {
  it('returns the class unchanged at runtime (purely type-level)', () => {
    assert.equal(Model.for(), Model)
  })

  it('a bound model still extends Model (prototype chain intact)', () => {
    assert.equal(Object.getPrototypeOf(Account), Model)
    assert.ok(Account.prototype instanceof Model || Object.getPrototypeOf(Account.prototype) === Model.prototype)
  })

  it('static config (table) is preserved through the binding', () => {
    assert.equal(Account.table, 'accounts')
  })

  it('compiles the type-level binding contract', () => {
    // The proofs live in typeProofs() above; reaching here means the test build
    // type-checked the binding (typed columns, typed chains, legacy unaffected).
    assert.ok(true)
  })
})

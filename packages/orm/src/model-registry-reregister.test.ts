import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'

// ─── ModelRegistry.register — dev HMR re-import ──────────────
//
// Regression for the HMR reboot-window plan's REOPEN #2: a dev re-boot
// re-evaluates `app/Models/*.ts`, yielding a NEW class identity with the same
// `name`. The old guard (`_store.models.has(name)`) silently ignored it — the
// registry stayed pointed at the STALE class and the fresh class's relation
// accessors were never installed on its prototype, so a consumer that
// introspects the model (a schema-builder walking relations) saw a half-wired
// model. register() now re-points the registry and re-installs the accessors on
// the fresh class for a same-name/different-identity registration.

/** Build a fresh `ReimportProbe` class identity (same name each call). */
function makeProbe(): typeof Model {
  class ReimportProbe extends Model {
    static table = 'reimport_probe'
    // A belongsToMany relation → installBelongsToManyMethods adds a `tags`
    // accessor on the prototype. (Cast: we only need the install to fire; the
    // accessor body isn't invoked here.)
    static relations = { tags: { type: 'belongsToMany' } } as unknown as (typeof Model)['relations']
  }
  return ReimportProbe
}

const protoHas = (C: typeof Model, m: string): boolean =>
  typeof (C.prototype as unknown as Record<string, unknown>)[m] === 'function'

describe('ModelRegistry.register — dev HMR re-import (same name, new identity)', () => {
  it('re-points the registry at the fresh class and re-installs its relation accessors', () => {
    const A1 = makeProbe()
    ModelRegistry.register(A1)
    assert.strictEqual(ModelRegistry.all().get('ReimportProbe'), A1, 'first registration')
    assert.equal(protoHas(A1, 'tags'), true, 'A1 got its belongsToMany accessor')

    // Dev HMR re-import → a brand-new class identity, same name.
    const A2 = makeProbe()
    assert.notStrictEqual(A2, A1, 'distinct class identity')
    assert.equal(protoHas(A2, 'tags'), false, 'fresh class has no accessor yet')

    ModelRegistry.register(A2)
    // THE FIX: was a silent no-op before (registry stuck on A1, A2 half-wired).
    assert.strictEqual(ModelRegistry.all().get('ReimportProbe'), A2, 're-import re-points the registry')
    assert.equal(protoHas(A2, 'tags'), true, 'accessor re-installed on the fresh prototype')
  })

  it('re-registering the EXACT same class stays a no-op', () => {
    const A = makeProbe()
    ModelRegistry.register(A)
    const before = ModelRegistry.all().get('ReimportProbe')
    ModelRegistry.register(A) // same identity
    assert.strictEqual(ModelRegistry.all().get('ReimportProbe'), before, 'idempotent for the same class')
  })
})

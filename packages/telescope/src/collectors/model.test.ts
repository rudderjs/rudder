// ModelCollector guard tests (correctness-sweep follow-up).
//
// All production coverage of this collector rides the `onRegister`
// subscription: at telescope boot the ModelRegistry is EMPTY — model
// registration is lazy (a model registers on its first query, which fires
// during request handling, long after provider boot) — so the initial
// `registry.all()` pass observes nothing in a real app. If a refactor ever
// drops the `onRegister` subscription, model recording dies silently for
// every app while an initial-pass-only test stays green (the #934 shape).
// These tests pin the late-registration path (production reality) and the
// already-registered path.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '@rudderjs/orm'
import type { OrmAdapter } from '@rudderjs/contracts'
import { MemoryStorage } from '../storage.js'
import { ModelCollector } from './model.js'
import type { TelescopeEntry } from '../types.js'

/** Minimal adapter — just enough surface for Model.create()'s _doCreate. */
function stubAdapter(): OrmAdapter {
  const qb = {
    create: async (d: Record<string, unknown>) => ({ id: 1, ...d }),
    where:  () => qb,
    get:    async () => [],
  }
  return { query: () => qb } as unknown as OrmAdapter
}

describe('ModelCollector', () => {
  beforeEach(() => {
    ModelRegistry.reset()
    ModelRegistry.set(stubAdapter())
  })

  it('observes a model registered AFTER boot via onRegister — the production path', async () => {
    const storage   = new MemoryStorage()
    const collector = new ModelCollector(storage)
    // Boot against an empty registry — exactly what production sees: no model
    // has been queried yet when TelescopeProvider boots.
    assert.equal(ModelRegistry.all().size, 0, 'registry must be empty at collector boot')
    await collector.register()

    class Widget extends Model {
      static override table = 'widgets'
      declare name?: string
    }
    // The same call Model.query() makes on a model's first query.
    ModelRegistry.register(Widget)

    await Widget.create({ name: 'first' })

    const entries = storage.list({ type: 'model' }) as TelescopeEntry[]
    assert.equal(entries.length, 1, 'late-registered model must be recorded')
    const entry = entries[0]!
    assert.equal(entry.content['model'],  'Widget')
    assert.equal(entry.content['action'], 'created')
    assert.ok(entry.tags.includes('model:Widget'))
    assert.ok(entry.tags.includes('action:created'))
  })

  it('observes a model already registered at boot via the initial all() pass', async () => {
    class Gadget extends Model {
      static override table = 'gadgets'
      declare name?: string
    }
    ModelRegistry.register(Gadget)

    const storage   = new MemoryStorage()
    const collector = new ModelCollector(storage)
    await collector.register()

    await Gadget.create({ name: 'early' })

    const entries = storage.list({ type: 'model' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.content['model'], 'Gadget')
  })
})

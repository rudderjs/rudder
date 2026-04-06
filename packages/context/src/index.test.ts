import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context, runWithContext, hasContext, ContextMiddleware } from './index.js'
import type { DehydratedContext } from './index.js'

// ─── Context.add / get / has / all / forget ───────────────

describe('Context basic data', () => {
  it('add() and get() work within a context scope', () => {
    runWithContext(() => {
      Context.add('user', 'alice')
      assert.strictEqual(Context.get('user'), 'alice')
    })
  })

  it('has() returns true for existing keys', () => {
    runWithContext(() => {
      Context.add('key', 1)
      assert.ok(Context.has('key'))
      assert.ok(!Context.has('missing'))
    })
  })

  it('all() returns all public data as a plain object', () => {
    runWithContext(() => {
      Context.add('a', 1)
      Context.add('b', 2)
      assert.deepStrictEqual(Context.all(), { a: 1, b: 2 })
    })
  })

  it('forget() removes a key', () => {
    runWithContext(() => {
      Context.add('x', 1)
      Context.forget('x')
      assert.ok(!Context.has('x'))
    })
  })

  it('get() returns undefined outside a context', () => {
    assert.strictEqual(Context.get('anything'), undefined)
  })

  it('all() returns {} outside a context', () => {
    assert.deepStrictEqual(Context.all(), {})
  })
})

// ─── Hidden data ──────────────────────────────────────────

describe('Context hidden data', () => {
  it('addHidden() and getHidden() work', () => {
    runWithContext(() => {
      Context.addHidden('secret', 'token123')
      assert.strictEqual(Context.getHidden('secret'), 'token123')
    })
  })

  it('hidden data is excluded from all()', () => {
    runWithContext(() => {
      Context.add('public', 1)
      Context.addHidden('secret', 2)
      assert.deepStrictEqual(Context.all(), { public: 1 })
    })
  })

  it('allHidden() returns only hidden data', () => {
    runWithContext(() => {
      Context.add('public', 1)
      Context.addHidden('secret', 2)
      assert.deepStrictEqual(Context.allHidden(), { secret: 2 })
    })
  })

  it('allWithHidden() returns both', () => {
    runWithContext(() => {
      Context.add('public', 1)
      Context.addHidden('secret', 2)
      assert.deepStrictEqual(Context.allWithHidden(), { public: 1, secret: 2 })
    })
  })
})

// ─── Stacks ───────────────────────────────────────────────

describe('Context stacks', () => {
  it('push() appends to a stack', () => {
    runWithContext(() => {
      Context.push('breadcrumbs', 'home')
      Context.push('breadcrumbs', 'dashboard')
      assert.deepStrictEqual(Context.stack('breadcrumbs'), ['home', 'dashboard'])
    })
  })

  it('stack() returns [] for non-existent key', () => {
    runWithContext(() => {
      assert.deepStrictEqual(Context.stack('nope'), [])
    })
  })

  it('stack() returns [] outside a context', () => {
    assert.deepStrictEqual(Context.stack('anything'), [])
  })
})

// ─── Scoped context ──────────────────────────────────────

describe('Context.scope()', () => {
  it('child changes do not leak to parent', () => {
    runWithContext(() => {
      Context.add('color', 'blue')

      Context.scope(() => {
        Context.add('color', 'red')
        Context.add('extra', 'yes')
        assert.strictEqual(Context.get('color'), 'red')
      })

      assert.strictEqual(Context.get('color'), 'blue')
      assert.ok(!Context.has('extra'))
    })
  })

  it('child inherits parent data', () => {
    runWithContext(() => {
      Context.add('inherited', 42)

      Context.scope(() => {
        assert.strictEqual(Context.get('inherited'), 42)
      })
    })
  })

  it('works without an existing context (creates fresh)', () => {
    Context.scope(() => {
      Context.add('key', 'val')
      assert.strictEqual(Context.get('key'), 'val')
    })
  })
})

// ─── Conditional ──────────────────────────────────────────

describe('Context.when()', () => {
  it('executes fn when condition is truthy', () => {
    runWithContext(() => {
      const result = Context.when(true, (ctx) => {
        ctx.add('flag', 'on')
        return 'done'
      })
      assert.strictEqual(result, 'done')
      assert.strictEqual(Context.get('flag'), 'on')
    })
  })

  it('returns undefined when condition is falsy', () => {
    runWithContext(() => {
      const result = Context.when(false, () => 'nope')
      assert.strictEqual(result, undefined)
    })
  })
})

// ─── Remember (memoize) ──────────────────────────────────

describe('Context.remember()', () => {
  it('caches the result of fn for the request lifetime', () => {
    runWithContext(() => {
      let calls = 0
      const get = () => Context.remember('expensive', () => { calls++; return 42 })

      assert.strictEqual(get(), 42)
      assert.strictEqual(get(), 42)
      assert.strictEqual(calls, 1)
    })
  })

  it('different scopes get independent caches', () => {
    let n = 0
    const factory = () => ++n

    let first: number | undefined
    runWithContext(() => {
      first = Context.remember('id', factory)
    })

    let second: number | undefined
    runWithContext(() => {
      second = Context.remember('id', factory)
    })

    assert.strictEqual(first, 1)
    assert.strictEqual(second, 2)
  })
})

// ─── Dehydrate / Hydrate ─────────────────────────────────

describe('dehydrate / hydrate', () => {
  it('round-trips data and stacks', () => {
    let payload: DehydratedContext | undefined

    runWithContext(() => {
      Context.add('user', 'alice')
      Context.add('tenant', 42)
      Context.push('tags', 'a')
      Context.push('tags', 'b')
      Context.addHidden('secret', 'hidden')

      payload = Context.dehydrate()
    })

    assert.ok(payload)
    assert.deepStrictEqual(payload!.data, { user: 'alice', tenant: 42 })
    assert.deepStrictEqual(payload!.stacks, { tags: ['a', 'b'] })

    // Hydrate into a new context
    runWithContext(() => {
      Context.hydrate(payload!)
      assert.strictEqual(Context.get('user'), 'alice')
      assert.deepStrictEqual(Context.stack('tags'), ['a', 'b'])
      // Hidden data is NOT carried over
      assert.strictEqual(Context.getHidden('secret'), undefined)
    })
  })

  it('dehydrate() returns empty objects outside a context', () => {
    const payload = Context.dehydrate()
    assert.deepStrictEqual(payload, { data: {}, stacks: {} })
  })
})

// ─── Flush ────────────────────────────────────────────────

describe('Context.flush()', () => {
  it('clears all data, hidden, stacks, and memo', () => {
    runWithContext(() => {
      Context.add('a', 1)
      Context.addHidden('b', 2)
      Context.push('c', 3)
      Context.remember('d', () => 4)

      Context.flush()

      assert.deepStrictEqual(Context.all(), {})
      assert.deepStrictEqual(Context.allHidden(), {})
      assert.deepStrictEqual(Context.stack('c'), [])
      // remember should re-run factory after flush
      let calls = 0
      Context.remember('d', () => { calls++; return 5 })
      assert.strictEqual(calls, 1)
    })
  })

  it('is a no-op outside a context', () => {
    Context.flush() // should not throw
  })
})

// ─── runWithContext / hasContext ───────────────────────────

describe('runWithContext', () => {
  it('establishes a fresh context scope', () => {
    assert.ok(!hasContext())

    runWithContext(() => {
      assert.ok(hasContext())
      Context.add('inside', true)
      assert.strictEqual(Context.get('inside'), true)
    })

    assert.ok(!hasContext())
  })

  it('nested runWithContext creates independent scopes', () => {
    runWithContext(() => {
      Context.add('outer', 1)

      runWithContext(() => {
        assert.ok(!Context.has('outer'))
        Context.add('inner', 2)
      })

      assert.ok(!Context.has('inner'))
      assert.strictEqual(Context.get('outer'), 1)
    })
  })
})

// ─── ContextMiddleware ────────────────────────────────────

describe('ContextMiddleware', () => {
  it('wraps next() in a context scope', async () => {
    const middleware = ContextMiddleware()
    let insideContext = false

    await middleware(
      {} as Parameters<typeof middleware>[0],
      {} as Parameters<typeof middleware>[1],
      async () => {
        insideContext = hasContext()
        Context.add('test', 'value')
      },
    )

    assert.ok(insideContext)
    // Context is gone after middleware completes
    assert.ok(!hasContext())
  })
})

// ─── requireStore throws outside context ──────────────────

describe('requireStore errors', () => {
  it('add() throws outside a context', () => {
    assert.throws(() => Context.add('x', 1), /No context scope active/)
  })

  it('addHidden() throws outside a context', () => {
    assert.throws(() => Context.addHidden('x', 1), /No context scope active/)
  })

  it('push() throws outside a context', () => {
    assert.throws(() => Context.push('x', 1), /No context scope active/)
  })

  it('remember() throws outside a context', () => {
    assert.throws(() => Context.remember('x', () => 1), /No context scope active/)
  })

  it('hydrate() throws outside a context', () => {
    assert.throws(() => Context.hydrate({ data: {}, stacks: {} }), /No context scope active/)
  })
})

import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { Router, ResourceRegistration, SingletonRegistration, runWithGroup } from './index.js'

// A controller that implements every verb. Each method records that it ran
// so tests can assert handlers wire up to the right method.
class FullController {
  index   () { return 'index' }
  create  () { return 'create' }
  store   () { return 'store' }
  show    () { return 'show' }
  edit    () { return 'edit' }
  update  () { return 'update' }
  destroy () { return 'destroy' }
}

// Partial controller — used to verify silent skipping for unimplemented verbs.
class PartialController {
  index() { return 'index' }
  show () { return 'show' }
}

class ProfileController {
  show   () { return 'show' }
  edit   () { return 'edit' }
  update () { return 'update' }
  create () { return 'create' }
  store  () { return 'store' }
  destroy() { return 'destroy' }
}

const noop: MiddlewareHandler = async () => {}

describe('Router.resource()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('registers the seven canonical CRUD routes', () => {
    r.resource('posts', FullController)
    const list = r.list()

    // 7 verbs + 1 PATCH alias for `update` = 8 total
    assert.strictEqual(list.length, 8)

    const sigs = list.map(rt => `${rt.method} ${rt.path}`)
    assert.deepStrictEqual(sigs, [
      'GET /posts',
      'GET /posts/create',
      'POST /posts',
      'GET /posts/:post',
      'GET /posts/:post/edit',
      'PUT /posts/:post',
      'PATCH /posts/:post',
      'DELETE /posts/:post',
    ])
  })

  it('returns a ResourceRegistration whose builders are in declaration order', () => {
    const reg = r.resource('posts', FullController)
    assert.ok(reg instanceof ResourceRegistration)
    assert.strictEqual(reg.builders.length, 8)
  })

  it('names routes <resource>.<verb> by default', () => {
    r.resource('posts', FullController)
    assert.strictEqual(r.getNamedRoute('posts.index'),   '/posts')
    assert.strictEqual(r.getNamedRoute('posts.create'),  '/posts/create')
    assert.strictEqual(r.getNamedRoute('posts.store'),   '/posts')
    assert.strictEqual(r.getNamedRoute('posts.show'),    '/posts/:post')
    assert.strictEqual(r.getNamedRoute('posts.edit'),    '/posts/:post/edit')
    assert.strictEqual(r.getNamedRoute('posts.update'),  '/posts/:post')
    assert.strictEqual(r.getNamedRoute('posts.destroy'), '/posts/:post')
  })

  it('skips verbs the controller does not implement', () => {
    r.resource('posts', PartialController)
    const sigs = r.list().map(rt => `${rt.method} ${rt.path}`)
    assert.deepStrictEqual(sigs, ['GET /posts', 'GET /posts/:post'])
    assert.strictEqual(r.has('posts.create'), false)
    assert.strictEqual(r.has('posts.update'), false)
  })

  it('honors `only` to restrict registered verbs', () => {
    r.resource('posts', FullController, { only: ['index', 'show'] })
    const sigs = r.list().map(rt => `${rt.method} ${rt.path}`)
    assert.deepStrictEqual(sigs, ['GET /posts', 'GET /posts/:post'])
  })

  it('honors `except` to exclude verbs', () => {
    r.resource('posts', FullController, { except: ['destroy'] })
    const list = r.list()
    // 6 remaining verbs + PATCH alias for update
    assert.strictEqual(list.length, 7)
    assert.strictEqual(list.find(rt => rt.method === 'DELETE'), undefined)
  })

  it('singularizes the resource name into the path param by default', () => {
    r.resource('categories', FullController)
    assert.ok(r.list().some(rt => rt.path === '/categories/:category'))
  })

  it('handles "ch/sh/x/z + es" plural endings (boxes → box)', () => {
    r.resource('boxes', FullController)
    assert.ok(r.list().some(rt => rt.path === '/boxes/:box'))
  })

  it('overrides the path param via parameters option', () => {
    r.resource('posts', FullController, { parameters: { posts: 'article' } })
    assert.ok(r.list().some(rt => rt.path === '/posts/:article'))
    assert.strictEqual(r.getNamedRoute('posts.show'), '/posts/:article')
  })

  it('overrides specific route names via names option', () => {
    r.resource('posts', FullController, { names: { show: 'posts.detail' } })
    assert.strictEqual(r.getNamedRoute('posts.detail'), '/posts/:post')
    assert.strictEqual(r.has('posts.show'), false)
  })

  it('applies middleware to every registered route', () => {
    r.resource('posts', FullController, { middleware: [noop] })
    for (const rt of r.list()) {
      assert.ok(rt.middleware.includes(noop), `expected ${rt.method} ${rt.path} to carry middleware`)
    }
  })

  it('lets builders[] add per-route constraints (whereNumber on show)', () => {
    const reg = r.resource('posts', FullController)
    // builders[3] is the show route (index / create / store / show)
    reg.builders[3]!.whereNumber('post')
    const show = r.list().find(rt => rt.method === 'GET' && rt.path.startsWith('/posts/:post'))
    assert.ok(show, 'show route should still exist')
    assert.match(show!.path, /\{\[0-9\]\+\}/)
  })

  it('binds handlers to the controller instance (this is preserved)', () => {
    class StatefulCtrl {
      private greeting = 'hi'
      index() { return this.greeting }
    }
    r.resource('posts', StatefulCtrl)
    const handler = r.list()[0]!.handler as () => string
    assert.strictEqual(handler(), 'hi')
  })

  it('combines with runWithGroup() to tag routes web/api', () => {
    runWithGroup('web', () => {
      r.resource('posts', FullController)
    })
    for (const rt of r.list()) {
      assert.strictEqual(rt.group, 'web', `${rt.method} ${rt.path} should carry group: 'web'`)
    }
  })

  it('inherits prefix and middleware from router.group()', () => {
    const adminMw: MiddlewareHandler = async () => {}
    r.group({ prefix: '/admin', middleware: [adminMw] }, () => {
      r.resource('posts', FullController)
    })
    for (const rt of r.list()) {
      assert.ok(rt.path.startsWith('/admin/posts'))
      assert.ok(rt.middleware.includes(adminMw))
    }
  })
})

describe('Router.apiResource()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('omits create and edit routes', () => {
    r.apiResource('posts', FullController)
    const sigs = r.list().map(rt => `${rt.method} ${rt.path}`)
    assert.deepStrictEqual(sigs, [
      'GET /posts',
      'POST /posts',
      'GET /posts/:post',
      'PUT /posts/:post',
      'PATCH /posts/:post',
      'DELETE /posts/:post',
    ])
    assert.strictEqual(r.has('posts.create'), false)
    assert.strictEqual(r.has('posts.edit'),   false)
  })

  it('still respects user-supplied except (combined with create+edit)', () => {
    r.apiResource('posts', FullController, { except: ['destroy'] })
    assert.strictEqual(r.has('posts.destroy'), false)
    assert.strictEqual(r.has('posts.create'),  false)
    assert.strictEqual(r.has('posts.edit'),    false)
    assert.strictEqual(r.has('posts.show'),    true)
  })
})

describe('Router.singleton()', () => {
  let r: Router
  beforeEach(() => { r = new Router() })

  it('registers show + edit + update only', () => {
    r.singleton('profile', ProfileController)
    const sigs = r.list().map(rt => `${rt.method} ${rt.path}`)
    assert.deepStrictEqual(sigs, [
      'GET /profile',
      'GET /profile/edit',
      'PUT /profile',
      'PATCH /profile',
    ])
  })

  it('returns a SingletonRegistration', () => {
    const reg = r.singleton('profile', ProfileController)
    assert.ok(reg instanceof SingletonRegistration)
  })

  it('.creatable() adds GET /create and POST', () => {
    r.singleton('profile', ProfileController).creatable()
    const sigs = r.list().map(rt => `${rt.method} ${rt.path}`)
    assert.ok(sigs.includes('GET /profile/create'))
    assert.ok(sigs.includes('POST /profile'))
    assert.strictEqual(r.has('profile.create'), true)
    assert.strictEqual(r.has('profile.store'),  true)
  })

  it('.destroyable() adds DELETE', () => {
    r.singleton('profile', ProfileController).destroyable()
    const sigs = r.list().map(rt => `${rt.method} ${rt.path}`)
    assert.ok(sigs.includes('DELETE /profile'))
    assert.strictEqual(r.has('profile.destroy'), true)
  })

  it('.creatable().destroyable() chains', () => {
    const reg = r.singleton('profile', ProfileController).creatable().destroyable()
    assert.ok(reg instanceof SingletonRegistration)
    assert.strictEqual(r.list().length, 4 /* base */ + 2 /* create */ + 1 /* destroy */)
  })
})

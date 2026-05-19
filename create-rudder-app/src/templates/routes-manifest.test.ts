import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TemplateContext } from '../templates.js'
import { getProfileRoutes } from './routes-manifest.js'

const noPkgs: TemplateContext['packages'] = {
  auth: false, sanctum: false, passport: false, socialite: false,
  queue: false, storage: false, scheduler: false, image: false,
  mail: false, notifications: false, broadcast: false, sync: false,
  ai: false, mcp: false, boost: false,
  localization: false, pennant: false,
  telescope: false, pulse: false, horizon: false,
  crypt: false, http: false, process: false, concurrency: false,
  terminal: false,
}

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    name:       'my-app',
    db:         'sqlite',
    orm:        'prisma',
    authSecret: 'test-secret',
    appKey:     'test-app-key',
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages:   noPkgs,
    ...overrides,
  }
}

describe('getProfileRoutes()', () => {
  it('returns just / on a packageless minimal profile', () => {
    const routes = getProfileRoutes(ctx())
    assert.equal(routes.length, 1)
    assert.equal(routes[0]?.path, '/')
    assert.equal(routes[0]?.contributedBy, 'welcome')
  })

  it('adds auth UI routes when packages.auth + react', () => {
    const routes = getProfileRoutes(ctx({ packages: { ...noPkgs, auth: true } }))
    const paths = routes.map(r => r.path)
    assert.ok(paths.includes('/login'))
    assert.ok(paths.includes('/register'))
    assert.ok(paths.includes('/forgot-password'))
  })

  it('skips auth UI routes on vue (no vendored views yet)', () => {
    const routes = getProfileRoutes(ctx({
      packages:   { ...noPkgs, auth: true },
      frameworks: ['vue'],
      primary:    'vue',
    }))
    const paths = routes.map(r => r.path)
    assert.ok(!paths.includes('/login'))
    assert.ok(!paths.includes('/register'))
  })

  it('emits no routes on an API-only profile (api-service recipe parked)', () => {
    // The api-service recipe (frameworks: []) currently can't build because
    // Vike requires at least one page. Until that's resolved upstream, the
    // manifest emits nothing for no-frontend profiles — keep this pinned so
    // we notice when the recipe becomes buildable.
    const routes = getProfileRoutes(ctx({
      frameworks: [],
      packages:   { ...noPkgs, auth: true, http: true },
    }))
    assert.equal(routes.length, 0)
  })

  it('emits no /demos routes (demos dropped from the scaffolder)', () => {
    const routes = getProfileRoutes(ctx({
      packages: { ...noPkgs, auth: true, queue: true, mail: true, pennant: true },
    }))
    const paths = routes.map(r => r.path)
    for (const p of paths) {
      assert.ok(!p.startsWith('/demos'), `manifest should not emit demo URL "${p}"`)
    }
  })

  it('mounts admin dashboards when packages are selected', () => {
    const routes = getProfileRoutes(ctx({
      packages: { ...noPkgs, telescope: true, pulse: true, horizon: true },
    }))
    const paths = routes.map(r => r.path)
    assert.ok(paths.includes('/telescope'))
    assert.ok(paths.includes('/pulse'))
    assert.ok(paths.includes('/horizon'))
  })

  it('omits welcome SSR marker for multi-framework projects', () => {
    const routes = getProfileRoutes(ctx({
      frameworks: ['react', 'vue'],
      primary:    'react',
    }))
    const root = routes.find(r => r.path === '/')
    assert.ok(root)
    assert.equal(root?.ssrMarker, undefined)
  })
})

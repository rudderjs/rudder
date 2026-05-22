import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { router, runWithGroup } from '../index.js'
import { registerRouteListCommand } from './route-list.js'

interface Handler {
  (args: string[]): void | Promise<void>
}

class FakeRudder {
  handler: Handler | null = null
  command(_name: string, handler: Handler): { description(text: string): unknown } {
    this.handler = handler
    return { description: () => undefined }
  }
}

interface MwSnapshot {
  global: unknown[]
  groups: { web: unknown[]; api: unknown[] }
}

function installInstanceWithSnapshot(snapshot: MwSnapshot | null): void {
  const g = globalThis as Record<string, unknown>
  if (snapshot === null) {
    delete g['__rudderjs_instance__']
    return
  }
  g['__rudderjs_instance__'] = { middlewareSnapshot: () => snapshot }
}

const requestIdMiddleware = async (): Promise<void> => {}
const RateLimit = async (): Promise<void> => {}
const CsrfMiddleware = async (): Promise<void> => {}
const AuthMiddleware = async (): Promise<void> => {}
const noop = async (): Promise<void> => {}

const handler = (): void => {}

const realLog = console.log
let captured: string[] = []

beforeEach(() => {
  router.reset()
  captured = []
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(' ')) }
})

afterEach(() => {
  console.log = realLog
  router.reset()
  delete (globalThis as Record<string, unknown>)['__rudderjs_instance__']
})

async function runCommand(args: string[] = []): Promise<void> {
  const fake = new FakeRudder()
  registerRouteListCommand(fake)
  assert.ok(fake.handler, 'handler should be registered')
  await fake.handler(args)
}

function joined(): string {
  return captured.join('\n')
}

describe('route:list --verbose', () => {
  it('prints the resolved [global → group → route] stack when verbose is on', async () => {
    runWithGroup('web', () => {
      router.get('/dashboard', handler, [AuthMiddleware])
    })

    installInstanceWithSnapshot({
      global: [requestIdMiddleware],
      groups: {
        web: [RateLimit, CsrfMiddleware],
        api: [],
      },
    })

    await runCommand(['--verbose'])

    const out = joined()
    assert.match(out, /\/dashboard/)
    assert.match(out, /\[global\][\s\S]*requestIdMiddleware/)
    assert.match(out, /\[web\][\s\S]*RateLimit, CsrfMiddleware/)
    assert.match(out, /\[route\][\s\S]*AuthMiddleware/)
  })

  it('renders routes with no group tag without any [web]/[api] layer', async () => {
    router.get('/health', handler)

    installInstanceWithSnapshot({
      global: [requestIdMiddleware],
      groups: { web: [RateLimit], api: [] },
    })

    await runCommand(['--verbose'])

    const out = joined()
    assert.match(out, /\/health/)
    assert.match(out, /\[global\]/)
    assert.doesNotMatch(out, /\[web\]/)
    assert.doesNotMatch(out, /\[api\]/)
  })

  it('distinguishes web vs api group middleware per route', async () => {
    runWithGroup('web', () => {
      router.get('/page', handler)
    })
    runWithGroup('api', () => {
      router.get('/items', handler)
    })

    installInstanceWithSnapshot({
      global: [],
      groups: {
        web: [CsrfMiddleware],
        api: [AuthMiddleware],
      },
    })

    await runCommand(['--verbose'])

    const out = joined()
    // /page should get the web group stack, /items the api group stack
    const pageIdx = out.indexOf('/page')
    const itemsIdx = out.indexOf('/items')
    assert.ok(pageIdx >= 0 && itemsIdx >= 0)
    const pageBlock = out.slice(pageIdx, itemsIdx > pageIdx ? itemsIdx : out.length)
    const itemsBlock = itemsIdx > pageIdx ? out.slice(itemsIdx) : ''
    assert.match(pageBlock, /\[web\][\s\S]*CsrfMiddleware/)
    assert.doesNotMatch(pageBlock, /AuthMiddleware/)
    assert.match(itemsBlock, /\[api\][\s\S]*AuthMiddleware/)
    assert.doesNotMatch(itemsBlock, /CsrfMiddleware/)
  })

  it('falls back to summary view with a warning when the snapshot is unavailable', async () => {
    runWithGroup('web', () => {
      router.get('/dashboard', handler, [AuthMiddleware])
    })

    installInstanceWithSnapshot(null)

    await runCommand(['--verbose'])

    const out = joined()
    assert.match(out, /middleware snapshot unavailable/)
    assert.match(out, /\/dashboard/)
  })

  it('--verbose --json includes resolved.global / .group / .route arrays per api route', async () => {
    runWithGroup('web', () => {
      router.get('/dashboard', handler, [AuthMiddleware])
    })

    installInstanceWithSnapshot({
      global: [requestIdMiddleware],
      groups: { web: [CsrfMiddleware], api: [] },
    })

    await runCommand(['--verbose', '--json'])

    const parsed = JSON.parse(captured[0]!) as {
      api: { method: string; path: string; group?: string; resolved?: { global: string[]; group: string[]; route: string[] } }[]
    }
    const route = parsed.api.find(r => r.path === '/dashboard')
    assert.ok(route, '/dashboard route should be present')
    assert.strictEqual(route.group, 'web')
    assert.ok(route.resolved, 'resolved should be present in verbose+json')
    assert.deepStrictEqual(route.resolved.global, ['requestIdMiddleware'])
    assert.deepStrictEqual(route.resolved.group, ['CsrfMiddleware'])
    assert.deepStrictEqual(route.resolved.route, ['AuthMiddleware'])
  })

  it('default (no --verbose) preserves the original summary output', async () => {
    runWithGroup('web', () => {
      router.get('/dashboard', handler, [noop])
    })
    installInstanceWithSnapshot({ global: [], groups: { web: [], api: [] } })

    await runCommand([])

    const out = joined()
    assert.match(out, /API Routes/)
    assert.match(out, /\/dashboard/)
    assert.doesNotMatch(out, /\[global\]/)
    assert.doesNotMatch(out, /\[web\]/)
  })
})

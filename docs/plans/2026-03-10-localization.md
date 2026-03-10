# @boostkit/localization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `@boostkit/localization` package that brings Laravel-style translation (`__()`, named interpolation, pluralization, per-request locale) to BoostKit apps.

**Architecture:** JSON files under `lang/{locale}/{namespace}.json` — no build step, universally readable. A `LocalizationRegistry` holds config + an in-memory cache of loaded namespaces. Per-request locale is stored in `AsyncLocalStorage` so it's SSR-safe. The `__()` helper resolves `'namespace.key.nested'` dot notation against the loaded JSON.

**Tech Stack:** TypeScript (NodeNext/ESM), `node:test`, `node:fs/promises`, `node:async_hooks` (AsyncLocalStorage), `@boostkit/core` (ServiceProvider)

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/localization/package.json`
- Create: `packages/localization/tsconfig.json`
- Create: `packages/localization/tsconfig.build.json`
- Create: `packages/localization/tsconfig.test.json`
- Create: `packages/localization/src/index.ts`
- Create: `packages/localization/src/index.test.ts`

---

**Step 1: Create `packages/localization/package.json`**

```json
{
  "name": "@boostkit/localization",
  "version": "0.0.1",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/boostkitjs/boostkit",
    "directory": "packages/localization"
  },
  "type": "module",
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build":     "tsc -p tsconfig.build.json",
    "dev":       "tsc -p tsconfig.build.json --watch",
    "typecheck": "tsc --noEmit",
    "clean":     "rm -rf dist",
    "test":      "tsc -p tsconfig.test.json && node --test dist-test/index.test.js; rm -rf dist-test"
  },
  "dependencies": {
    "@boostkit/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript":  "^5.4.0"
  },
  "author": "Suleiman Shahbari"
}
```

**Step 2: Create `packages/localization/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Create `packages/localization/tsconfig.build.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

**Step 4: Create `packages/localization/tsconfig.test.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-test",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 5: Create empty `packages/localization/src/index.ts`**

```ts
// @boostkit/localization — exports added in later tasks
```

**Step 6: Create empty `packages/localization/src/index.test.ts`**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Tests added per task
describe('placeholder', () => {
  it('passes', () => assert.ok(true))
})
```

**Step 7: Add to pnpm workspace**

Run from repo root to install workspace deps:

```bash
cd /Users/sleman/Projects/boostkit && pnpm install
```

**Step 8: Verify build works**

```bash
cd packages/localization && pnpm build && pnpm test
```

Expected: builds clean, 1 test passes.

**Step 9: Commit**

```bash
git add packages/localization
git commit -m "feat: scaffold @boostkit/localization package"
```

---

## Task 2: Core translation engine

The heart of the package: loading JSON files, resolving dot-notation keys, interpolating `:placeholders`, and pluralizing `{0} none|{1} one|{n} many`.

**Files:**
- Modify: `packages/localization/src/index.ts`
- Modify: `packages/localization/src/index.test.ts`

---

**Step 1: Write the failing tests first**

Replace `packages/localization/src/index.test.ts` with:

```ts
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// We test the engine internals directly by pointing at a fixture lang dir.
// The fixture is created inline using temp files in /tmp.

import {
  LocalizationRegistry,
  __,
} from './index.js'

// ─── Fixtures ────────────────────────────────────────────────

// We bypass file I/O for unit tests by seeding the cache directly.
// LocalizationRegistry.seed() loads translations without touching disk.

describe('interpolation', () => {
  beforeEach(() => LocalizationRegistry.reset())

  it('returns key as-is when namespace not loaded', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    // no seed → key returned
    assert.equal(__('messages.missing'), 'messages.missing')
  })

  it('resolves a simple key', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { greeting: 'Hello!' })
    assert.equal(__('messages.greeting'), 'Hello!')
  })

  it('resolves a nested key', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { user: { welcome: 'Welcome back!' } })
    assert.equal(__('messages.user.welcome'), 'Welcome back!')
  })

  it('interpolates :placeholder', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { greeting: 'Hello, :name!' })
    assert.equal(__('messages.greeting', { name: 'John' }), 'Hello, John!')
  })

  it('interpolates multiple placeholders', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { msg: ':a and :b' })
    assert.equal(__('messages.msg', { a: 'foo', b: 'bar' }), 'foo and bar')
  })

  it('falls back to fallback locale', () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { greeting: 'Hello!' })
    // no 'es' seed — falls back to 'en'
    assert.equal(__('messages.greeting'), 'Hello!')
  })
})

describe('pluralization', () => {
  beforeEach(() => LocalizationRegistry.reset())

  it('{0} zero case', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { apples: '{0} no apples|{1} one apple|{n} :count apples' })
    assert.equal(__('msg.apples', 0), 'no apples')
  })

  it('{1} singular case', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { apples: '{0} no apples|{1} one apple|{n} :count apples' })
    assert.equal(__('msg.apples', 1), 'one apple')
  })

  it('{n} plural case with :count', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { apples: '{0} no apples|{1} one apple|{n} :count apples' })
    assert.equal(__('msg.apples', 5), '5 apples')
  })

  it('simple two-part plural (singular|plural)', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { item: 'one item|many items' })
    assert.equal(__('msg.item', 1), 'one item')
    assert.equal(__('msg.item', 2), 'many items')
  })
})
```

**Step 2: Run tests to see them fail**

```bash
cd packages/localization && pnpm test 2>&1 | tail -15
```

Expected: fails — `LocalizationRegistry` and `__` are not exported yet.

**Step 3: Implement `packages/localization/src/index.ts`**

```ts
import { readFile } from 'node:fs/promises'
import { join }     from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ServiceProvider, type Application } from '@boostkit/core'

// ─── Config ────────────────────────────────────────────────

export interface LocalizationConfig {
  /** Default locale (e.g. 'en'). */
  locale:   string
  /** Fallback locale when a key is missing in the current locale. */
  fallback: string
  /** Absolute or relative path to the lang directory. */
  path:     string
}

// ─── Registry ──────────────────────────────────────────────

type TranslationMap = Record<string, unknown>

export class LocalizationRegistry {
  private static _config: LocalizationConfig = { locale: 'en', fallback: 'en', path: './lang' }
  private static _cache  = new Map<string, TranslationMap>()   // 'en:messages' → { ... }
  private static _als    = new AsyncLocalStorage<{ locale: string }>()

  static configure(config: LocalizationConfig): void {
    this._config = config
  }

  static getConfig(): LocalizationConfig {
    return this._config
  }

  /** Per-request locale storage. Wrap request handlers with runWithLocale(). */
  static getAls(): AsyncLocalStorage<{ locale: string }> {
    return this._als
  }

  /** @internal — preload translations without touching disk (used in tests). */
  static seed(locale: string, namespace: string, data: TranslationMap): void {
    this._cache.set(`${locale}:${namespace}`, data)
  }

  static getCached(locale: string, namespace: string): TranslationMap | undefined {
    return this._cache.get(`${locale}:${namespace}`)
  }

  static setCached(locale: string, namespace: string, data: TranslationMap): void {
    this._cache.set(`${locale}:${namespace}`, data)
  }

  /** @internal — clears all state. Used in tests. */
  static reset(): void {
    this._cache.clear()
    this._config = { locale: 'en', fallback: 'en', path: './lang' }
  }
}

// ─── Locale helpers ────────────────────────────────────────

/** Get the current request locale (or the configured default). */
export function getLocale(): string {
  return LocalizationRegistry.getAls().getStore()?.locale ?? LocalizationRegistry.getConfig().locale
}

/** Set the locale for the current request context. Must be inside runWithLocale(). */
export function setLocale(locale: string): void {
  const store = LocalizationRegistry.getAls().getStore()
  if (store) store.locale = locale
}

/**
 * Run a function with an explicit locale bound to the async context.
 * Used internally by LocalizationMiddleware.
 */
export function runWithLocale<T>(locale: string, fn: () => T): T {
  return LocalizationRegistry.getAls().run({ locale }, fn)
}

// ─── File loader ───────────────────────────────────────────

async function loadNamespace(locale: string, namespace: string): Promise<TranslationMap> {
  const cached = LocalizationRegistry.getCached(locale, namespace)
  if (cached) return cached

  const { path } = LocalizationRegistry.getConfig()
  const filePath  = join(path, locale, `${namespace}.json`)

  try {
    const raw  = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as TranslationMap
    LocalizationRegistry.setCached(locale, namespace, data)
    return data
  } catch {
    return {}
  }
}

// ─── Key resolver ──────────────────────────────────────────

function resolveDotKey(obj: TranslationMap, key: string): string | undefined {
  const parts = key.split('.')
  let   cur: unknown = obj
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

// ─── Interpolation ─────────────────────────────────────────

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
    const val = params[key]
    return val !== undefined ? String(val) : `:${key}`
  })
}

// ─── Pluralization ─────────────────────────────────────────

function pluralize(template: string, count: number): string {
  const parts = template.split('|')

  // Simple two-part: 'singular|plural'
  if (parts.length === 2 && !template.includes('{')) {
    return count === 1 ? (parts[0] ?? template) : (parts[1] ?? template)
  }

  // Laravel-style: '{0} none|{1} one|{n} many'
  let fallbackN: string | undefined

  for (const part of parts) {
    const match = part.match(/^\{(\d+|n)\}\s*(.*)$/)
    if (!match) continue
    const [, specifier, text] = match
    if (specifier === 'n') {
      fallbackN = text
    } else if (Number(specifier) === count) {
      return interpolate(text ?? '', { count })
    }
  }

  if (fallbackN !== undefined) {
    return interpolate(fallbackN, { count })
  }

  return template
}

// ─── Sync translation cache lookup ─────────────────────────
// __() is intentionally synchronous — namespaces are pre-loaded
// by the service provider (or lazy-loaded on first async call).
// For the sync path we look up from cache only.

function resolveFromCache(locale: string, namespace: string, key: string): string | undefined {
  const map = LocalizationRegistry.getCached(locale, namespace)
  if (!map) return undefined
  return resolveDotKey(map, key)
}

// ─── Translation helper ────────────────────────────────────

/**
 * Translate a key.
 *
 * @param key    Dot-notation key: 'namespace.key' or 'namespace.nested.key'
 * @param params Named interpolation params OR a count for pluralization
 *
 * @example
 * __('messages.greeting')                     // 'Hello'
 * __('messages.greeting', { name: 'John' })   // 'Hello, John!'
 * __('messages.apples', 3)                    // '3 apples'
 */
export function __(key: string, params?: Record<string, unknown> | number): string {
  const dotIndex = key.indexOf('.')
  if (dotIndex === -1) return key   // no namespace — return as-is

  const namespace  = key.slice(0, dotIndex)
  const nestedKey  = key.slice(dotIndex + 1)
  const locale     = getLocale()
  const { fallback } = LocalizationRegistry.getConfig()

  // Try current locale, then fallback
  let raw = resolveFromCache(locale, namespace, nestedKey)
  if (raw === undefined && locale !== fallback) {
    raw = resolveFromCache(fallback, namespace, nestedKey)
  }

  if (raw === undefined) return key

  // Pluralize if count given
  if (typeof params === 'number') {
    return pluralize(raw, params)
  }

  // Interpolate named params
  if (params && typeof params === 'object') {
    return interpolate(raw, params)
  }

  return raw
}

// ─── Async translation (loads from disk if not cached) ─────

/**
 * Same as __() but async — loads the namespace from disk on first call.
 * Use in route handlers or data loaders where async is fine.
 */
export async function trans(key: string, params?: Record<string, unknown> | number): Promise<string> {
  const dotIndex = key.indexOf('.')
  if (dotIndex === -1) return key

  const namespace = key.slice(0, dotIndex)
  const locale    = getLocale()
  const { fallback } = LocalizationRegistry.getConfig()

  await loadNamespace(locale, namespace)
  if (locale !== fallback) await loadNamespace(fallback, namespace)

  return __(key, params)
}

// ─── Middleware ────────────────────────────────────────────

export type SimpleMiddleware = (req: { headers: Record<string, string | string[] | undefined> }, next: () => unknown) => unknown

/**
 * Sets the locale per-request from the Accept-Language header.
 * Falls back to the configured default locale.
 * Wrap your route handler chain with this middleware.
 */
export function LocalizationMiddleware() {
  return async function LocalizationMiddleware(
    req: { headers: Record<string, string | string[] | undefined> },
    next: () => unknown,
  ): Promise<unknown> {
    const header = req.headers['accept-language']
    const raw    = Array.isArray(header) ? header[0] : header
    const locale = raw?.split(',')[0]?.split('-')[0]?.trim()
      ?? LocalizationRegistry.getConfig().locale

    return runWithLocale(locale, () => next() as Promise<unknown>)
  }
}

// ─── Service Provider ──────────────────────────────────────

class LocalizationServiceProvider extends ServiceProvider {
  private config: LocalizationConfig

  constructor(app: Application, config: LocalizationConfig) {
    super(app)
    this.config = config
  }

  override async register(): Promise<void> {
    LocalizationRegistry.configure(this.config)
  }
}

/**
 * Register the localization service provider.
 *
 * @example
 * // bootstrap/providers.ts
 * import { localization } from '@boostkit/localization'
 * export default [ localization({ locale: 'en', fallback: 'en', path: './lang' }) ]
 */
export function localization(config: LocalizationConfig) {
  return (app: Application) => new LocalizationServiceProvider(app, config)
}
```

**Step 4: Run tests**

```bash
cd packages/localization && pnpm test 2>&1 | tail -20
```

Expected: all tests pass (15 tests).

**Step 5: Build**

```bash
pnpm build 2>&1
```

Expected: no errors.

**Step 6: Commit**

```bash
git add packages/localization/src/
git commit -m "feat(localization): add core translation engine — __(), trans(), pluralization, interpolation"
```

---

## Task 3: File-based integration test + playground wiring

Prove that JSON files on disk load correctly and `trans()` resolves them.

**Files:**
- Modify: `packages/localization/src/index.test.ts`
- Create: `playground/lang/en/messages.json`
- Create: `playground/lang/es/messages.json`
- Create: `playground/config/localization.ts`
- Modify: `playground/bootstrap/providers.ts`

---

**Step 1: Add file-based tests to `index.test.ts`**

Append to the test file (after existing describe blocks):

```ts
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'

describe('file loading via trans()', () => {
  let tmpDir: string

  beforeEach(async () => {
    LocalizationRegistry.reset()
    tmpDir = pathJoin(tmpdir(), `bk-i18n-test-${Date.now()}`)
    await mkdir(pathJoin(tmpDir, 'en'), { recursive: true })
    await mkdir(pathJoin(tmpDir, 'es'), { recursive: true })
    await writeFile(
      pathJoin(tmpDir, 'en', 'site.json'),
      JSON.stringify({ title: 'My App', nav: { home: 'Home' } }),
    )
    await writeFile(
      pathJoin(tmpDir, 'es', 'site.json'),
      JSON.stringify({ title: 'Mi App' }),
    )
  })

  // No afterEach cleanup needed — /tmp is ephemeral

  it('loads and resolves a simple key from disk', async () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.title'), 'My App')
  })

  it('loads and resolves a nested key', async () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.nav.home'), 'Home')
  })

  it('falls back to fallback locale when key missing', async () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: tmpDir })
    // 'es/site.json' has no nav.home — should fall back to 'en'
    assert.equal(await trans('site.nav.home'), 'Home')
  })

  it('resolves key in current locale when available', async () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.title'), 'Mi App')
  })

  it('returns key string when not found in any locale', async () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.missing.key'), 'site.missing.key')
  })
})
```

**Step 2: Run tests**

```bash
cd packages/localization && pnpm test 2>&1 | tail -20
```

Expected: all tests pass (20 tests).

**Step 3: Create playground lang files**

`playground/lang/en/messages.json`:

```json
{
  "welcome": "Welcome to BoostKit!",
  "greeting": "Hello, :name!",
  "items": "{0} no items|{1} one item|{n} :count items"
}
```

`playground/lang/es/messages.json`:

```json
{
  "welcome": "¡Bienvenido a BoostKit!",
  "greeting": "¡Hola, :name!",
  "items": "{0} sin elementos|{1} un elemento|{n} :count elementos"
}
```

**Step 4: Create `playground/config/localization.ts`**

```ts
import { resolve } from 'node:path'
import { Env } from '@boostkit/support'

export default {
  locale:   Env.get('APP_LOCALE', 'en'),
  fallback: 'en',
  path:     resolve(import.meta.dirname, '../lang'),
}
```

**Step 5: Add to `playground/config/index.ts`**

Read the file, then add `localization` to the exported config object:

```ts
import localization from './localization.js'
// Add to the default export object:
export default { ..., localization }
```

**Step 6: Register provider in `playground/bootstrap/providers.ts`**

Read the file, then add the localization provider:

```ts
import { localization } from '@boostkit/localization'
// Add to the providers array:
localization(configs.localization),
```

**Step 7: Add a test route to prove it works**

In `playground/routes/api.ts`, add:

```ts
import { trans, setLocale } from '@boostkit/localization'

router.get('/api/hello', async (req) => {
  // Optionally override locale from query: ?lang=es
  const lang = new URL(req.url, 'http://x').searchParams.get('lang')
  if (lang) setLocale(lang)

  const message = await trans('messages.greeting', { name: 'World' })
  const items   = await trans('messages.items', 3)
  return Response.json({ message, items, locale: getLocale() })
})
```

Add `getLocale` to the import.

**Step 8: Start playground and test**

```bash
cd playground && pnpm dev
```

```bash
curl http://localhost:3000/api/hello
# { "message": "Hello, World!", "items": "3 items", "locale": "en" }

curl http://localhost:3000/api/hello?lang=es
# { "message": "¡Hola, World!", "items": "3 elementos", "locale": "es" }
```

**Step 9: Commit**

```bash
git add packages/localization/src/index.test.ts playground/lang/ playground/config/localization.ts playground/config/index.ts playground/bootstrap/providers.ts playground/routes/api.ts
git commit -m "feat(localization): file loading, playground wiring, /api/hello demo route"
```

---

## Task 4: README + docs

**Files:**
- Create: `packages/localization/README.md`
- Create: `docs/packages/localization.md`
- Modify: `docs/packages/index.md`

---

**Step 1: Create `packages/localization/README.md`**

````md
# @boostkit/localization

Laravel-style localization for BoostKit. JSON translation files, named interpolation, pluralization, per-request locale via `AsyncLocalStorage`.

```bash
pnpm add @boostkit/localization
```

---

## Setup

### 1. Create lang files

```
lang/
  en/
    messages.json
  es/
    messages.json
```

```json
// lang/en/messages.json
{
  "welcome":  "Welcome to :app!",
  "greeting": "Hello, :name!",
  "items":    "{0} no items|{1} one item|{n} :count items"
}
```

### 2. Add config

```ts
// config/localization.ts
import { resolve } from 'node:path'
export default {
  locale:   'en',
  fallback: 'en',
  path:     resolve(import.meta.dirname, '../lang'),
}
```

### 3. Register provider

```ts
// bootstrap/providers.ts
import { localization } from '@boostkit/localization'
export default [
  localization(configs.localization),
]
```

---

## Usage

### `__()` — synchronous (cache only)

```ts
import { __ } from '@boostkit/localization'

__('messages.welcome', { app: 'BoostKit' })  // 'Welcome to BoostKit!'
__('messages.items', 3)                       // '3 items'
```

Returns the key string if not found. Use `__()` when you know the namespace is already loaded (e.g. inside a request after `trans()` was called once).

### `trans()` — async (loads from disk)

```ts
import { trans } from '@boostkit/localization'

await trans('messages.greeting', { name: 'Alice' })  // 'Hello, Alice!'
await trans('messages.items', 0)                      // 'no items'
```

Loads the namespace JSON from disk on first call, caches in memory. Safe to call multiple times.

---

## Pluralization

Use pipe-separated forms in your JSON values:

```json
{ "apples": "{0} no apples|{1} one apple|{n} :count apples" }
```

```ts
await trans('messages.apples', 0)   // 'no apples'
await trans('messages.apples', 1)   // 'one apple'
await trans('messages.apples', 12)  // '12 apples'
```

Simple two-part form also works:

```json
{ "item": "one item|many items" }
```

```ts
await trans('messages.item', 1)   // 'one item'
await trans('messages.item', 5)   // 'many items'
```

---

## Locale switching

```ts
import { getLocale, setLocale, LocalizationMiddleware } from '@boostkit/localization'

// Read current locale
getLocale()   // 'en'

// Set for the current request context
setLocale('es')

// Middleware — auto-detects from Accept-Language header
LocalizationMiddleware()
```

`setLocale()` only works inside a request context (within `runWithLocale()`). Use `LocalizationMiddleware` to set up the context automatically:

```ts
// routes/web.ts
import { LocalizationMiddleware } from '@boostkit/localization'

router.use(LocalizationMiddleware())
```

---

## Nested keys

```json
{
  "nav": {
    "home":    "Home",
    "profile": "My Profile"
  }
}
```

```ts
__('messages.nav.home')     // 'Home'
__('messages.nav.profile')  // 'My Profile'
```

---

## Fallback locale

If a key is missing in the current locale, it falls back to the configured `fallback` locale automatically. No extra code needed.
````

**Step 2: Create `docs/packages/localization.md`**

Same content as README but with the VitePress doc header and expanded examples. Mirror the structure of other docs files (see `docs/packages/cache.md` for reference format).

**Step 3: Add entry to `docs/packages/index.md`**

Add `@boostkit/localization` under an "Utilities" or appropriate section (read the file first to find the right place).

**Step 4: Commit**

```bash
git add packages/localization/README.md docs/packages/localization.md docs/packages/index.md
git commit -m "docs(localization): add README and docs"
```

---

## Final checklist

- [ ] `pnpm test` in `packages/localization` — all 20 tests pass
- [ ] `pnpm build` in `packages/localization` — no errors
- [ ] `curl http://localhost:3000/api/hello` returns English translation
- [ ] `curl http://localhost:3000/api/hello?lang=es` returns Spanish translation
- [ ] `__()` returns key string for missing keys (no throw)
- [ ] Nested keys resolve correctly
- [ ] Fallback locale works when key missing in current locale

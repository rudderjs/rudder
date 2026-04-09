# Creating a New Package

This guide covers how to add a new `@rudderjs/*` package to the monorepo. Follow these conventions so every package stays consistent, testable, and publishable.

---

## Before you start — should this be a new package?

Apply the **tight-coupling checklist** from `Architecture.md` first. A new package is justified when:

- It has an **adapter boundary** (e.g., different databases, queues, cloud providers)
- It has a **portability boundary** (Node.js-only vs edge-compatible)
- It is **independently useful** without the rest of RudderJS
- It would be **optional** for most apps

If the code is always deployed alongside an existing package and has no meaningful standalone behaviour, merge it instead.

---

## Scaffold the package

```bash
cd packages
mkdir my-feature
cd my-feature
```

### `package.json`

```json
{
  "name": "@rudderjs/my-feature",
  "version": "0.0.1",
  "description": "One-line description.",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types":  "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build":     "tsc -p tsconfig.build.json",
    "dev":       "tsc -p tsconfig.build.json --watch",
    "typecheck": "tsc --noEmit",
    "test":      "tsc -p tsconfig.test.json && node --test dist-test/index.test.js; rm -rf dist-test"
  },
  "dependencies": {},
  "peerDependencies": {},
  "devDependencies": {
    "@rudderjs/tsconfig": "workspace:*"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

**Dependency rules:**

| Use | When |
|---|---|
| `dependencies` | Always needed at runtime |
| `peerDependencies` | Framework packages the user already has (`@rudderjs/core`, `@rudderjs/orm`) |
| `devDependencies` | Build-time only — types, test utilities |
| `optionalDependencies` | Heavy drivers the user opts into (`ioredis`, `@aws-sdk/client-s3`) |

> **Never** put `@rudderjs/core` in `dependencies`. It creates a circular dependency through the DI container. Use `peerDependencies` instead and resolve it at runtime with `resolveOptionalPeer('@rudderjs/core')`.

---

## TypeScript setup (three-config split)

Every package uses three tsconfig files so the editor, build, and test tasks each get the right settings.

### `tsconfig.json` — editor / type-checking

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "src/**/*.test.ts"]
}
```

### `tsconfig.build.json` — production build

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

### `tsconfig.test.json` — test compilation

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

---

## Source conventions

### File layout

```
packages/my-feature/
├── src/
│   ├── index.ts          # public API — re-exports only, no logic here
│   ├── MyFeature.ts      # main implementation
│   └── index.test.ts     # tests (same directory, same rootDir)
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.test.json
└── package.json
```

### Module system

- All imports use `.js` extensions (NodeNext resolution):
  ```ts
  import { helper } from './helper.js'   // ✓
  import { helper } from './helper'      // ✗
  ```
- Top-level `await` is fine — all packages are ESM.
- No CommonJS (`require`, `module.exports`).

### Strict TypeScript

All packages inherit `tsconfig.base.json` which enables:

```json
"strict": true,
"exactOptionalPropertyTypes": true,
"noUncheckedIndexedAccess": true
```

`noUncheckedIndexedAccess` means array reads return `T | undefined`. Use non-null assertion (`!`) only when you have verified the index is in bounds, or use optional chaining.

---

## Service Provider pattern

If your package needs to boot with the application, expose a **factory function** that returns a `ServiceProvider` class:

```ts
// src/index.ts
import type { ServiceProvider } from '@rudderjs/core'

export interface MyFeatureConfig {
  option: string
}

export function myFeature(config: MyFeatureConfig): typeof ServiceProvider {
  return class MyFeatureProvider extends (
    require('@rudderjs/core') as typeof import('@rudderjs/core')
  ).ServiceProvider {
    async register() {
      this.app.singleton('my-feature', () => new MyFeature(config))
    }
    async boot() { /* optional */ }
  }
}
```

Then in the app's `providers.ts`:

```ts
import { myFeature } from '@rudderjs/my-feature'

export default [myFeature({ option: 'value' })]
```

---

## Testing

Use Node.js built-in `node:test` — no Jest, no Vitest.

```ts
// src/index.test.ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MyFeature } from './MyFeature.js'

describe('@rudderjs/my-feature', () => {
  describe('MyFeature', () => {
    it('does the thing', () => {
      const f = new MyFeature({ option: 'test' })
      assert.equal(f.result(), 'expected')
    })

    it('throws on invalid input', () => {
      assert.throws(() => new MyFeature({ option: '' }), /invalid/)
    })
  })
})
```

**Testing rules:**

- Always read the source before writing tests — test actual behaviour, not assumptions.
- One top-level `describe` per file named after the package (`'@rudderjs/my-feature'`). This prevents `node:test` concurrent describe interference.
- No mocking of internal modules — test real behaviour. Mock only external I/O (network, filesystem) when unavoidable.
- Run with `pnpm test` from the package directory.

---

## Optional peer resolution

When your package optionally integrates with another RudderJS package, resolve it at runtime rather than importing it statically:

```ts
import { resolveOptionalPeer } from '@rudderjs/support'

// In a method, not at module level:
async function getOrm() {
  const orm = await resolveOptionalPeer('@rudderjs/orm')
  if (!orm) throw new Error('@rudderjs/orm is required for this feature')
  return orm
}
```

This avoids bundling packages the user may not have installed and prevents circular imports.

---

## Bundled translations & overrides

If your package ships its own UI strings (panel chrome, buttons, toasts, error messages — anything the end user reads), follow the **bundled defaults + JSON overrides** convention so apps can localize your package without forking it. `@pilotiq/panels` (in [pilotiq-io/pilotiq](https://github.com/pilotiq-io/pilotiq)) is the reference implementation; do the same in your package.

### 1. Ship bundled defaults as TypeScript

Bundled translations are the canonical, type-safe schema. Keep them in `src/i18n/`:

```ts
// src/i18n/en.ts
export const en = {
  signOut:        'Sign out',
  search:         'Search :label…',
  noResultsTitle: 'No results',
  // …
}
export type MyPackageI18n = typeof en
```

```ts
// src/i18n/ar.ts
import type { MyPackageI18n } from './en.js'
export const ar: MyPackageI18n = {
  signOut:        'تسجيل الخروج',
  search:         'بحث :label…',
  noResultsTitle: 'لا توجد نتائج',
  // …
}
```

Add at least `en` (acts as the universal fallback). Keep the schema **flat** unless you have a real reason to nest — it's easier to override.

### 2. Provide a sync resolver with override support

```ts
// src/i18n/index.ts
import { en } from './en.js'
import { ar } from './ar.js'
import type { MyPackageI18n } from './en.js'

export type { MyPackageI18n }

const NAMESPACE   = 'my-package'              // matches lang/<locale>/my-package.json
const translations: Record<string, MyPackageI18n> = { en, ar }
const mergedCache = new Map<string, MyPackageI18n>()

export function getMyPackageI18n(locale: string): MyPackageI18n {
  const cached = mergedCache.get(locale)
  if (cached) return cached

  const base     = locale.split('-')[0] ?? locale
  const bundled  = translations[locale] ?? translations[base] ?? en
  const override = getOverride(locale) ?? getOverride(base)
  const merged   = override ? deepMerge(bundled, override) : bundled

  mergedCache.set(locale, merged)
  return merged
}

function getOverride(locale: string): Partial<MyPackageI18n> | undefined {
  const g     = globalThis as Record<string, unknown>
  const cache = g['__rudderjs_localization_cache__'] as Map<string, unknown> | undefined
  const data  = cache?.get(`${locale}:${NAMESPACE}`) as Partial<MyPackageI18n> | undefined
  return data && Object.keys(data).length > 0 ? data : undefined
}

// deepMerge implementation — see packages/panels/src/i18n/index.ts

/** @internal — for tests + HMR */
export function _clearI18nCache(): void { mergedCache.clear() }
```

The resolver must be **sync** because UI render paths (React components, schema resolvers) can't `await`. The merge happens once per locale, then it's cached.

### 3. Preload at boot from your service provider

`getMyPackageI18n()` is sync, so the override file has to be in `@rudderjs/localization`'s cache before the first render. Preload it from your provider's `boot()`:

```ts
// src/MyPackageServiceProvider.ts
import { ServiceProvider } from '@rudderjs/core'
import { _clearI18nCache } from './i18n/index.js'

async function preloadTranslations(): Promise<void> {
  try {
    const loc = await import('@rudderjs/localization') as {
      preloadNamespace?: (locale: string, namespace: string) => Promise<void>
      LocalizationRegistry?: { getConfig(): { locale: string; fallback: string } }
    }
    if (!loc.preloadNamespace || !loc.LocalizationRegistry) return
    const { locale, fallback } = loc.LocalizationRegistry.getConfig()
    await loc.preloadNamespace(locale, 'my-package')
    if (fallback && fallback !== locale) {
      await loc.preloadNamespace(fallback, 'my-package')
    }
    // Drop anything merged before the override landed in cache.
    _clearI18nCache()
  } catch {
    // @rudderjs/localization not installed — fall back to bundled defaults.
  }
}

export class MyPackageServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    await preloadTranslations()
    // …rest of your boot logic
  }
}
```

The dynamic import + try/catch makes `@rudderjs/localization` an **optional peer dependency** — your package still works standalone.

### 4. Declare the optional peer

```jsonc
// package.json
{
  "peerDependencies": {
    "@rudderjs/localization": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@rudderjs/localization": { "optional": true }
  },
  "devDependencies": {
    "@rudderjs/localization": "workspace:*"
  }
}
```

The devDep is required so TypeScript can resolve types in the workspace.

### 5. Publish a starter override file

Create an empty `lang/en/my-package.json` in your package and register it as publishable so users can scaffold it via the CLI:

```ts
// In your service provider's register()
const langDir = new URL('../lang/en', import.meta.url).pathname
this.publishes([
  { from: langDir, to: 'lang/en', tag: 'my-package-translations' },
])
```

Add `"lang"` to your package.json `files` array so the directory ships to npm. Users then run:

```bash
pnpm rudder vendor:publish --tag=my-package-translations
```

### 6. Serialize the merged i18n to the client — never recompute

This is the gotcha that bites every time. `@rudderjs/localization` reads files via `node:fs/promises`, so its cache only exists **on the server**. If your React components call `getMyPackageI18n(locale)` themselves on the client, they'll get bundled defaults (the cache is empty there) and overwrite the SSR'd HTML during hydration.

Always pass the **merged i18n object** down through the page-data layer:

```ts
// Server: in your page +data.ts or meta route
const i18n = getMyPackageI18n(locale)
return { i18n, locale, /* … */ }

// Client: consume from props, do not recompute
function MyProvider({ i18n, children }: { i18n: MyPackageI18n; children: ReactNode }) {
  return <Context.Provider value={i18n}>{children}</Context.Provider>
}
```

If you have both a "navigation" meta and a "full" meta shape (like `Panel.toNavigationMeta()` vs `toMeta()`), make sure the layout's data source includes `i18n` — otherwise the client falls back to bundled defaults silently.

### 7. Document override keys

Point users at your bundled `en.ts` as the canonical key list — that's the source of truth.

### 8. Naming conventions

| Concept                | Convention                                            |
|------------------------|-------------------------------------------------------|
| Override file          | `lang/<locale>/<package-short-name>.json`             |
| Localization namespace | `<package-short-name>` (matches the file basename)    |
| Vendor publish tag     | `<package-short-name>-translations`                   |
| Bundled defaults       | `src/i18n/<locale>.ts`, schema in `en.ts`             |
| Resolver function      | `get<PackageName>I18n(locale)`                        |

For example, `@pilotiq/panels` uses the short name `pilotiq`. Pick a short, distinct name so multiple packages don't collide on the same override file.

---

## Exports checklist

`src/index.ts` should export everything a user needs — and nothing internal:

```ts
// ✓ Export the public class
export { MyFeature } from './MyFeature.js'

// ✓ Export the factory function (ServiceProvider pattern)
export { myFeature } from './provider.js'

// ✓ Export config and result types
export type { MyFeatureConfig, MyFeatureResult } from './types.js'

// ✗ Do not export internal helpers, test utilities, or private classes
```

---

## Add to the monorepo

1. Add the package to `pnpm-workspace.yaml` if not using the glob `packages/*`.
2. Run `pnpm install` from the root to link workspace dependencies.
3. Run `pnpm build` from the root before using it in the playground.
4. Add an entry to `docs/packages/index.md` and create a doc page.

---

## Publishing

```bash
# From the repo root — creates a changeset describing what changed
pnpm changeset

# Bump versions and update CHANGELOGs
pnpm changeset:version

# Build + publish all changed packages
pnpm release
```

For a one-off publish of a single package:

```bash
cd packages/my-feature
pnpm publish --access public --no-git-checks
```

npm requires browser passkey auth — press Enter when prompted.

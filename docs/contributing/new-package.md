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

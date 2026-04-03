# Creating a Panels Extension Package

A panels extension adds new capabilities to `@rudderjs/panels` without modifying it — new field types, editor integrations, custom renderers. `@rudderjs/panels-lexical` is the canonical example.

---

## How panels extensions work

`@rudderjs/panels` ships with a **registry system** for pluggable components:

```ts
// packages/panels/src/editorRegistry.ts
export const editorRegistry = new Map<string, React.ComponentType<...>>()

export function registerEditor(key: string, Component: React.ComponentType<...>) {
  editorRegistry.set(key, Component)
}
```

When a field renders, it checks the registry first and falls back to a built-in. Your extension calls `register*()` at startup — the panels package never imports your package directly.

This is the **critical rule**: `@rudderjs/panels` must never import `@rudderjs/panels-*`. The dependency only flows one way.

---

## Package structure

```
packages/panels-myext/
├── src/
│   ├── index.ts              # exports registerMyExt(), ServiceProvider
│   ├── MyExtEditor.tsx       # React component(s)
│   └── index.test.ts
├── pages/                    # publishable React pages/components
│   └── _components/
│       └── MyExtField.tsx
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.test.json
└── package.json
```

### `package.json`

```json
{
  "name": "@rudderjs/panels-myext",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types":  "./dist/index.d.ts"
    }
  },
  "peerDependencies": {
    "@rudderjs/panels": "*",
    "react": "^18 || ^19"
  },
  "devDependencies": {
    "@rudderjs/panels": "workspace:*",
    "react": "^19"
  }
}
```

`@rudderjs/panels` is a **peer dependency** (user must have it) and a **devDependency** (for local development). It is never in `dependencies`.

---

## The register function

Expose a `register*()` function that installs your components into the panels registry:

```ts
// src/index.ts
import { editorRegistry } from '@rudderjs/panels'
import type { EditorProps } from '@rudderjs/panels'

export function registerMyExt() {
  // Lazy import the heavy React component — avoids bundling it on the server
  editorRegistry.set('my-editor', async () => {
    const { MyExtEditor } = await import('./MyExtEditor.js')
    return MyExtEditor
  })
}

export { myExtProvider } from './provider.js'
```

---

## The ServiceProvider

Expose a ServiceProvider factory so the app can boot your extension:

```ts
// src/provider.ts
export function myExtProvider() {
  return class MyExtServiceProvider {
    static publishable = [
      {
        from:  new URL('../pages', import.meta.url).pathname,
        to:    'pages/(panels)',
        tag:   'panels-myext-pages',
      },
    ]

    async boot() {
      // Server-side boot if needed (e.g. register rudder commands)
    }
  }
}
```

Register it in the app:

```ts
// bootstrap/providers.ts
import { myExtProvider } from '@rudderjs/panels-myext'

export default [
  panels([AdminPanel]),
  myExtProvider(),
]
```

---

## Loading the extension (avoiding the cycle)

**Never** statically import your extension from inside `@rudderjs/panels`. Instead, `+Layout.tsx` (the panels layout, published to the app) loads extensions dynamically:

```ts
// pages/(panels)/@panel/+Layout.tsx
'use client'

// Dynamic import — no static dep, no Turbo cycle, loads on the client only
import('@rudderjs/panels-myext')
  .then(({ registerMyExt }) => registerMyExt())
  .catch(() => {}) // not installed — silent skip
```

This pattern means:
- The panels package has **zero knowledge** of your extension at build time.
- If the user hasn't installed your package, the `catch` swallows the import error silently.
- Turbo's cycle detection never fires because there is no static dependency edge.

---

## Publishing pages with `vendor:publish`

Pages in your `pages/` directory are **source files** that get copied into the user's app by `vendor:publish`. They are not compiled into `dist/`.

### Register publishable paths in your ServiceProvider

```ts
static publishable = [
  {
    from: new URL('../pages', import.meta.url).pathname,
    to:   'pages/(panels)',
    tag:  'panels-myext-pages',
  },
]
```

### User runs:

```bash
pnpm rudder vendor:publish --tag=panels-myext-pages
```

This copies your `pages/` directory into `pages/(panels)/` in their app, where Vite processes the files directly as part of the build.

### Important: re-publish after source edits

During development in the monorepo, the playground uses **copied files**, not a symlink to `pages/`. After editing source files under `packages/panels-myext/pages/`, re-publish:

```bash
# From playground/
pnpm rudder vendor:publish --tag=panels-myext-pages --force
```

---

## Bundle size best practices

Because your pages are bundled into the client, keep imports lean:

**Avoid importing the full icon set:**
```ts
// ✗ pulls in all ~2,000 icons (783 kB)
import { icons } from 'lucide-react'
const Icon = icons['MyIcon']

// ✓ tree-shakeable — only MyIcon is bundled
import { MyIcon } from 'lucide-react'

// ✓ for dynamic icon names — lazy-load the full set asynchronously
let cache: Record<string, React.ComponentType> | null = null
async function getIcon(name: string) {
  if (!cache) cache = (await import('lucide-react')).icons as Record<string, React.ComponentType>
  return cache[name]
}
```

**Use dynamic imports for heavy libraries:**
```ts
// ✗ blocks initial render with 500+ kB
import { Chart } from 'heavy-chart-lib'

// ✓ loaded only when the component renders
const [mod, setMod] = useState(null)
useEffect(() => { import('heavy-chart-lib').then(setMod) }, [])
if (!mod) return <Skeleton />
```

---

## Tailwind class scanning

If your published components use Tailwind classes, tell the user to add a `@source` directive:

```css
/* src/index.css */
@source "../node_modules/@rudderjs/panels-myext/dist";
```

Document this clearly in your README — it's easy to forget and results in missing styles.

---

## SSR externals

If your package has server-only dependencies, add them to the `SSR_EXTERNALS` list in `packages/vite/src/index.ts`:

```ts
const SSR_EXTERNALS = [
  // ... existing entries
  '@rudderjs/panels-myext-heavy-dep',
]
```

This prevents Node.js-only code from leaking into the client bundle.

---

## Reference implementation

Study `@rudderjs/panels-lexical` as the complete reference:

| File | Purpose |
|---|---|
| `packages/panels-lexical/src/index.ts` | Exports `registerLexical()` |
| `packages/panels-lexical/src/LexicalEditor.tsx` | The heavy React component |
| `packages/panels-lexical/pages/` | Published `CollaborativePlainText.tsx` etc. |
| `packages/panels/pages/@panel/+Layout.tsx` | Dynamic import site — the cycle-breaker |
| `packages/panels/src/editorRegistry.ts` | The registry your extension writes into |

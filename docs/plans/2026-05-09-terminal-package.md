# @rudderjs/terminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** New `@rudderjs/terminal` package that lets rudder commands render interactive React/Ink UIs in the terminal via `terminal('id', props)` — the same ergonomics as `view('id', props)` but for the terminal.

**Architecture:** `terminal('id', props)` discovers `app/Terminal/<PascalId>.tsx` at runtime via dynamic import, calls Ink's `render()` with the resolved React component and props, then awaits `waitUntilExit()` before returning `Promise<void>`. No changes to `@rudderjs/cli` or `@rudderjs/console` — the CLI runner already `await`s handler return values, so a `Promise<void>` just works. A `make:terminal` scaffolder command is wired into the CLI the same way `make:agent` is wired from `@rudderjs/ai`.

**Tech Stack:** Ink v5 (ESM-only, React 18), TypeScript NodeNext ESM, Node.js built-in test runner, pnpm workspace.

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/terminal/package.json`
- Create: `packages/terminal/tsconfig.json`
- Create: `packages/terminal/tsconfig.build.json`
- Create: `packages/terminal/tsconfig.test.json`
- Create: `packages/terminal/src/index.ts` (stub)

**Step 1: Create `packages/terminal/package.json`**

```json
{
  "name": "@rudderjs/terminal",
  "version": "1.0.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/rudderjs/rudder",
    "directory": "packages/terminal"
  },
  "type": "module",
  "files": ["dist", "boost"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "default": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./commands/make-terminal": {
      "import": "./dist/commands/make-terminal.js",
      "default": "./dist/commands/make-terminal.js",
      "types": "./dist/commands/make-terminal.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "clean": "rm -rf dist",
    "test": "tsc -p tsconfig.test.json && node --test dist-test/index.test.js; EXIT=$?; rm -rf dist-test; exit $EXIT"
  },
  "dependencies": {
    "ink": "^5.0.0"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "react": "^18.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.0.0"
  },
  "author": "Suleiman Shahbari"
}
```

**Step 2: Create `packages/terminal/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

**Step 3: Create `packages/terminal/tsconfig.build.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

**Step 4: Create `packages/terminal/tsconfig.test.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-test",
    "rootDir": "src",
    "tsBuildInfoFile": "./dist-test/.tsbuildinfo",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

**Step 5: Create stub `packages/terminal/src/index.ts`**

```ts
export {}
```

**Step 6: Install deps from repo root**

```bash
pnpm install
```

Expected: lockfile updated, `ink` appears under `packages/terminal` in node_modules.

**Step 7: Verify build compiles**

```bash
cd packages/terminal && pnpm build
```

Expected: `dist/index.js` created with empty export.

**Step 8: Commit**

```bash
git add packages/terminal/
git commit -m "feat(terminal): scaffold @rudderjs/terminal package"
```

---

## Task 2: `idToPath` + `resolveComponent`

**Files:**
- Create: `packages/terminal/src/resolve.ts`
- Create: `packages/terminal/src/index.test.ts` (tests first)

**Step 1: Write the failing test**

Create `packages/terminal/src/index.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { idToPath } from './resolve.js'

describe('idToPath()', () => {
  it('single segment — capitalises the id', () => {
    assert.equal(idToPath('dashboard'), 'app/Terminal/Dashboard')
  })

  it('dot notation — nested directory + capitalised filename', () => {
    assert.equal(idToPath('admin.users'), 'app/Terminal/Admin/Users')
  })

  it('three segments', () => {
    assert.equal(idToPath('admin.auth.login'), 'app/Terminal/Admin/Auth/Login')
  })

  it('already-capitalised id passes through unchanged', () => {
    assert.equal(idToPath('Dashboard'), 'app/Terminal/Dashboard')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/terminal && pnpm test
```

Expected: compile error — `resolve.ts` does not exist.

**Step 3: Implement `packages/terminal/src/resolve.ts`**

```ts
import path from 'node:path'
import fs from 'node:fs/promises'
import type { ComponentType } from 'react'

const EXTENSIONS = ['.tsx', '.ts', '.js', '.mjs']

/**
 * Convert a dot-notation terminal id to a relative file path (no extension).
 * 'dashboard'       → 'app/Terminal/Dashboard'
 * 'admin.users'     → 'app/Terminal/Admin/Users'
 */
export function idToPath(id: string): string {
  const segments = id
    .split('.')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
  return path.join('app', 'Terminal', ...segments)
}

/**
 * Resolve a terminal component by id.
 * Tries each extension in order; throws a clear error if not found.
 */
export async function resolveComponent(
  id: string,
  appRoot = process.cwd(),
): Promise<ComponentType<Record<string, unknown>>> {
  const rel = idToPath(id)

  for (const ext of EXTENSIONS) {
    const fullPath = path.join(appRoot, rel + ext)
    try {
      await fs.access(fullPath)
      const mod = await import(/* @vite-ignore */ fullPath) as {
        default?: ComponentType<Record<string, unknown>>
      }
      if (!mod.default) {
        throw new Error(
          `Terminal component "${id}" (${fullPath}) has no default export. ` +
          `Export a React component as the default export.`,
        )
      }
      return mod.default
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
  }

  throw new Error(
    `Terminal component "${id}" not found. ` +
    `Expected file at: ${path.join(appRoot, rel)}.{tsx,ts,js}`,
  )
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/terminal && pnpm test
```

Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add packages/terminal/src/
git commit -m "feat(terminal): add idToPath + resolveComponent with tests"
```

---

## Task 3: `terminal()` helper

**Files:**
- Create: `packages/terminal/src/terminal.ts`
- Modify: `packages/terminal/src/index.ts`
- Modify: `packages/terminal/src/index.test.ts` (add tests)

**Step 1: Write failing tests — add to `index.test.ts`**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guardTTY } from './terminal.js'

describe('guardTTY()', () => {
  it('throws CliError when stdout is not a TTY', () => {
    assert.throws(
      () => guardTTY(false),
      (e: unknown) => e instanceof Error && /TTY/.test((e as Error).message),
    )
  })

  it('does not throw when stdout is a TTY', () => {
    assert.doesNotThrow(() => guardTTY(true))
  })
})
```

**Step 2: Run test — verify it fails**

```bash
cd packages/terminal && pnpm test
```

Expected: compile error — `terminal.ts` does not exist.

**Step 3: Implement `packages/terminal/src/terminal.ts`**

```ts
import React from 'react'
import { render } from 'ink'
import { resolveComponent } from './resolve.js'

export type TerminalProps = Record<string, unknown>

/** @internal — exported for tests only */
export function guardTTY(isTTY: boolean | undefined): void {
  if (!isTTY) {
    throw new Error(
      'terminal() requires an interactive terminal (TTY). ' +
      'Not supported in non-interactive environments (CI, piped output).',
    )
  }
}

/**
 * Render a terminal view from `app/Terminal/` with controller-supplied props.
 *
 * @param id    Dot-notation component id (e.g. `'dashboard'` → `app/Terminal/Dashboard.tsx`)
 * @param props Plain object passed to the Ink component as props
 *
 * @example
 * Rudder.command('dashboard', async () => {
 *   return terminal('dashboard', { appName: 'RudderJS' })
 * })
 */
export async function terminal(id: string, props: TerminalProps = {}): Promise<void> {
  guardTTY(process.stdout.isTTY)
  const Component = await resolveComponent(id)
  const { waitUntilExit } = render(React.createElement(Component, props))
  await waitUntilExit()
}
```

**Step 4: Update `packages/terminal/src/index.ts`**

```ts
export { terminal } from './terminal.js'
export type { TerminalProps } from './terminal.js'
```

**Step 5: Update `packages/terminal/src/index.test.ts` — add the guardTTY import**

Add to the top of the test file (after existing imports):
```ts
import { guardTTY } from './terminal.js'
```

**Step 6: Run tests — verify all pass**

```bash
cd packages/terminal && pnpm test
```

Expected: 6 tests pass (4 idToPath + 2 guardTTY).

**Step 7: Build to verify types compile**

```bash
cd packages/terminal && pnpm build
```

Expected: `dist/index.js` + `dist/terminal.js` + `dist/resolve.js` emitted, no errors.

**Step 8: Commit**

```bash
git add packages/terminal/src/
git commit -m "feat(terminal): add terminal() helper with TTY guard + tests"
```

---

## Task 4: `make:terminal` scaffolder

**Files:**
- Create: `packages/terminal/src/commands/make-terminal.ts`
- Modify: `packages/terminal/src/index.ts` (re-export MakeSpec type, no new exports)
- Modify: `packages/cli/src/index.ts` (add loader)

**Step 1: Create `packages/terminal/src/commands/make-terminal.ts`**

```ts
import type { MakeSpec } from '@rudderjs/console'

export const makeTerminalSpec: MakeSpec = {
  name: 'make:terminal',
  description: 'Create a new terminal component',
  args: [{ name: 'name', description: 'Component name (e.g. Dashboard, Admin/Stats)' }],
  generate(args) {
    const raw  = (args[0] as string | undefined) ?? 'MyTerminal'
    const segments = raw.replace(/\\/g, '/').split('/')
    const name = segments[segments.length - 1] ?? 'MyTerminal'
    const dir  = ['app', 'Terminal', ...segments.slice(0, -1)].join('/')
    const file = `${dir}/${name}.tsx`

    return {
      files: [
        {
          path: file,
          content: [
            `import React from 'react'`,
            `import { Box, Text } from 'ink'`,
            ``,
            `interface ${name}Props {`,
            `  // add your props here`,
            `}`,
            ``,
            `export default function ${name}({}: ${name}Props) {`,
            `  return (`,
            `    <Box flexDirection="column" padding={1}>`,
            `      <Text bold>${name}</Text>`,
            `    </Box>`,
            `  )`,
            `}`,
          ].join('\n'),
        },
      ],
    }
  },
}
```

**Step 2: Add loader to `packages/cli/src/index.ts`**

In the `loaders` array inside `loadPackageCommands()`, add after the router loader:

```ts
// @rudderjs/terminal → make:terminal
async () => {
  const mod = await tryImport('@rudderjs/terminal', 'commands/make-terminal')
  registerMakeSpecs(mod['makeTerminalSpec'] as import('@rudderjs/console').MakeSpec)
},
```

**Step 3: Build both packages**

```bash
pnpm build --filter @rudderjs/terminal --filter @rudderjs/cli
```

Expected: both build without errors.

**Step 4: Verify the command appears in help**

```bash
cd playground && pnpm rudder make:terminal --help
```

Expected: shows description and `<name>` argument.

**Step 5: Commit**

```bash
git add packages/terminal/src/commands/ packages/cli/src/index.ts
git commit -m "feat(terminal): add make:terminal scaffolder command"
```

---

## Task 5: Playground demo

**Files:**
- Create: `playground/app/Terminal/Dashboard.tsx`
- Modify: `playground/routes/console.ts`

**Step 1: Create `playground/app/Terminal/Dashboard.tsx`**

```tsx
import React from 'react'
import { Box, Text, useApp } from 'ink'

interface DashboardProps {
  appName: string
  version?: string
}

export default function Dashboard({ appName, version = '1.0.0' }: DashboardProps) {
  const { exit } = useApp()

  // Exit after rendering — commands should complete, not hang
  React.useEffect(() => {
    const t = setTimeout(() => exit(), 100)
    return () => clearTimeout(t)
  }, [exit])

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{appName}</Text>
        <Text dimColor>  v{version}</Text>
      </Box>

      <Box flexDirection="column" gap={0}>
        <Text color="green">✓ Routes loaded</Text>
        <Text color="green">✓ Providers booted</Text>
        <Text color="green">✓ Database connected</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
```

> Note: `useApp().exit()` is how Ink components signal they're done. For interactive dashboards that run until `Ctrl+C`, remove the `useEffect` and Ink handles `SIGINT` automatically.

**Step 2: Register the command in `playground/routes/console.ts`**

Add at the top of the file:
```ts
import { terminal } from '@rudderjs/terminal'
```

Add after the `inspire` command:
```ts
Rudder.command('dashboard', async () => {
  return terminal('dashboard', {
    appName: 'RudderJS',
    version: '1.0.0',
  })
}).description('Show the app dashboard in the terminal')
```

**Step 3: Build packages, then test in playground**

```bash
# From repo root
pnpm build --filter @rudderjs/terminal

# From playground/
pnpm rudder dashboard
```

Expected: Ink renders the dashboard with app name, version, and status lines. Exits cleanly after ~100ms.

**Step 4: Verify `make:terminal` generates a valid file**

```bash
cd playground && pnpm rudder make:terminal Stats
```

Expected: creates `app/Terminal/Stats.tsx` with the stub component.

**Step 5: Commit**

```bash
git add playground/app/Terminal/ playground/routes/console.ts
git commit -m "feat(playground): add terminal dashboard demo command"
```

---

## Task 6: README + changeset

**Files:**
- Create: `packages/terminal/README.md`
- Create: `.changeset/<auto-name>.md`

**Step 1: Create `packages/terminal/README.md`**

```markdown
# @rudderjs/terminal

Laravel-style `terminal('id', props)` for the terminal — the same ergonomics as `view()`, but renders React/Ink components in the CLI instead of Vike pages in the browser.

## Installation

```bash
pnpm add @rudderjs/terminal react
```

## Usage

### 1. Create a terminal component

```tsx
// app/Terminal/Dashboard.tsx
import React from 'react'
import { Box, Text, useApp } from 'ink'

interface DashboardProps {
  appName: string
}

export default function Dashboard({ appName }: DashboardProps) {
  const { exit } = useApp()

  React.useEffect(() => {
    const t = setTimeout(() => exit(), 100)
    return () => clearTimeout(t)
  }, [exit])

  return (
    <Box padding={1}>
      <Text bold>{appName}</Text>
    </Box>
  )
}
```

### 2. Register a rudder command

```ts
// routes/console.ts
import { Rudder } from '@rudderjs/console'
import { terminal } from '@rudderjs/terminal'

Rudder.command('dashboard', async () => {
  return terminal('dashboard', { appName: 'MyApp' })
}).description('Show the dashboard')
```

### 3. Run it

```bash
pnpm rudder dashboard
```

## Component discovery

| `terminal(...)` call         | File resolved                         |
|------------------------------|---------------------------------------|
| `terminal('dashboard')`      | `app/Terminal/Dashboard.tsx`          |
| `terminal('admin.users')`    | `app/Terminal/Admin/Users.tsx`        |
| `terminal('auth.login')`     | `app/Terminal/Auth/Login.tsx`         |

## Scaffolding

```bash
pnpm rudder make:terminal Dashboard
pnpm rudder make:terminal Admin/Stats
```

## Notes

- Requires an interactive TTY — throws a clear error in CI / piped output
- Components must have a default export
- Use `useApp().exit()` from Ink to signal completion; omit it for long-running interactive UIs that exit on Ctrl+C
- `react` is a peer dependency — install it alongside this package (already present in vike-react apps)
```

**Step 2: Create a changeset**

```bash
pnpm changeset
```

- Select `@rudderjs/terminal` (new package, minor — but since 1.0.0 launch, treat as `patch` for CLI since only adding a loader)
- Message: `add @rudderjs/terminal — terminal('id', props) renders Ink/React components from app/Terminal/ in rudder commands`

Also bump `@rudderjs/cli` with `patch` for the `make:terminal` loader addition.

**Step 3: Final build + test across both packages**

```bash
pnpm build --filter @rudderjs/terminal --filter @rudderjs/cli
pnpm test --filter @rudderjs/terminal
```

Expected: all tests pass, both packages build clean.

**Step 4: Commit**

```bash
git add packages/terminal/README.md .changeset/
git commit -m "docs(terminal): README + changeset"
```

---

## Quick reference

| Command | What it does |
|---|---|
| `pnpm rudder dashboard` | Renders `app/Terminal/Dashboard.tsx` via Ink |
| `pnpm rudder make:terminal Name` | Scaffolds `app/Terminal/Name.tsx` |
| `terminal('id', props)` | Core helper — resolves component, renders, awaits exit |
| `idToPath('admin.users')` | `'app/Terminal/Admin/Users'` (no extension) |

## Pitfalls

- **Non-TTY environment**: `terminal()` throws if `process.stdout.isTTY` is falsy. Check `process.stdout.isTTY` before calling if you want a no-op fallback.
- **No default export**: the resolver throws a descriptive error. Always `export default function`.
- **Component hangs forever**: if your component never calls `exit()` or unmounts, `terminal()` never resolves. Use `useApp().exit()` or handle `Ctrl+C` via Ink's built-in `SIGINT` handling.
- **`jsx` compiler option**: `tsconfig.json` in this package sets `"jsx": "react-jsx"`. App tsconfigs using `@rudderjs/terminal` components in `app/Terminal/` also need `"jsx": "react-jsx"` (or `"react"`). Apps using `vike-react` already have this.

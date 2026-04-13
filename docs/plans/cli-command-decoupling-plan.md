# CLI Command Decoupling Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move domain-specific CLI commands from `@rudderjs/cli` to their owning packages, matching how `@rudderjs/queue`, `@rudderjs/schedule`, `@rudderjs/boost`, etc. already self-register commands via `rudder.command()` in their provider's `boot()`.

**Architecture:** Each package owns its commands. Runtime commands (migrate, route:list) register in the provider's `boot()` via `rudder.command()`. Scaffolder commands (`make:*`) export `MakeSpec` objects that CLI collects statically. The `MakeSpec` interface + `registerMake()` helper move to `@rudderjs/rudder` so any package can use them. `providers:discover` and `vendor:publish` logic moves to `@rudderjs/core` with thin CLI wrappers.

**Tech Stack:** TypeScript, Commander.js, `@rudderjs/rudder` (Command base), `@rudderjs/core` (providers)

---

## Current State

Commands living in `@rudderjs/cli` that contain domain logic for other packages:

| Command | Domain | Target Package |
|---|---|---|
| `migrate`, `migrate:fresh`, `migrate:status`, `make:migration`, `db:push`, `db:generate` | ORM | `@rudderjs/orm` |
| `route:list` (API routes) | Routing | `@rudderjs/router` |
| `route:list` (Vike page scanning) | Views | `@rudderjs/view` |
| `providers:discover` | Core lifecycle | `@rudderjs/core` |
| `vendor:publish` | Core lifecycle | `@rudderjs/core` |
| `make:agent` | AI | `@rudderjs/ai` |
| `make:mcp-server`, `make:mcp-tool`, `make:mcp-resource`, `make:mcp-prompt` | MCP | `@rudderjs/mcp` |

Commands that **stay** in CLI (generic scaffolders + CLI-intrinsic):
- `make:controller`, `make:model`, `make:job`, `make:middleware`, `make:request`, `make:provider`, `make:command`, `make:event`, `make:listener`, `make:mail`
- `command:list` (introspects the rudder registry — CLI's job)
- `module:make`, `module:publish` (CLI tooling)

## Design Decisions

### Runtime commands → `rudder.command()` in provider `boot()`

This is the established pattern (queue, schedule, storage, live, broadcast, mcp, boost all do this). The command handler lives in the package that owns the domain logic. The CLI discovers it automatically via `rudder.getCommands()`.

### Scaffolder commands (`make:*`) → export `MakeSpec` data

`make:*` commands skip boot — they can't register via provider `boot()`. Instead:

1. Move `MakeSpec` interface + `registerMake()` to `@rudderjs/rudder` (the command infrastructure package)
2. Each package exports its specs from a `commands/make` subpath: `@rudderjs/ai/commands/make` → `[{ command: 'make:agent', ... }]`
3. CLI statically imports specs from installed packages (try/catch, no boot needed)
4. Packages declare their make specs in `package.json` `rudderjs.make` field for discoverability

### `providers:discover` + `vendor:publish` → logic in `@rudderjs/core`, thin CLI wrapper

These are core lifecycle operations. The scanning/sorting/manifest-writing logic moves to `@rudderjs/core`. The CLI keeps a thin wrapper that calls it (these still skip boot — that's fine, the CLI imports the function directly).

### `route:list` → split between `@rudderjs/router` and `@rudderjs/view`

- `@rudderjs/router` registers `route:list` in its provider boot (it owns `router.list()`)
- `@rudderjs/view` contributes Vike page routes by emitting them into the same route list format
- CLI removes its `route-list.ts` entirely

---

## Phase 1: Move `MakeSpec` to `@rudderjs/rudder`

This unblocks packages to export their own scaffolder specs.

### Task 1.1: Add MakeSpec + registerMake to `@rudderjs/rudder`

**Files:**
- Create: `packages/rudder/src/make.ts`
- Modify: `packages/rudder/src/index.ts`
- Modify: `packages/rudder/package.json`

**Step 1: Create `packages/rudder/src/make.ts`**

Move the `MakeSpec` interface and `registerMake()` function from `packages/cli/src/commands/make/_shared.ts`. Keep the exact same implementation but import `chalk` (already a dep of cli — add to rudder or use raw ANSI like the rest of rudder).

```typescript
// packages/rudder/src/make.ts
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

export interface MakeSpec {
  command:     string
  description: string
  label:       string
  suffix?:     string
  directory:   string
  stub:        (className: string) => string
  afterCreate?: (className: string, relPath: string) => void
}

/** Global registry for MakeSpec objects from packages */
const makeRegistry: MakeSpec[] = []

/** Register one or more MakeSpec entries (called by packages at import time). */
export function registerMakeSpecs(...specs: MakeSpec[]): void {
  for (const spec of specs) {
    if (!makeRegistry.some(s => s.command === spec.command)) {
      makeRegistry.push(spec)
    }
  }
}

/** Get all registered MakeSpec entries. */
export function getMakeSpecs(): readonly MakeSpec[] {
  return makeRegistry
}

/**
 * Execute a make spec — write the scaffolded file to disk.
 * Used by the CLI to run make:* commands.
 */
export async function executeMakeSpec(
  spec: MakeSpec,
  name: string,
  opts: { force?: boolean },
): Promise<{ created: boolean; relPath: string; className: string }> {
  const className = spec.suffix && !name.endsWith(spec.suffix)
    ? `${name}${spec.suffix}`
    : name
  const relPath = `${spec.directory}/${className}.ts`
  const outPath = resolve(process.cwd(), relPath)

  if (existsSync(outPath) && !opts.force) {
    return { created: false, relPath, className }
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, spec.stub(className))
  spec.afterCreate?.(className, relPath)

  return { created: true, relPath, className }
}
```

**Step 2: Export from `packages/rudder/src/index.ts`**

Add to the bottom of the file:
```typescript
export { MakeSpec, registerMakeSpecs, getMakeSpecs, executeMakeSpec } from './make.js'
```

**Step 3: Build and typecheck**

```bash
cd packages/rudder && pnpm build && pnpm typecheck
```

---

## Phase 2: Move `make:agent` to `@rudderjs/ai`, `make:mcp-*` to `@rudderjs/mcp`

### Task 2.1: Add make specs to `@rudderjs/ai`

**Files:**
- Create: `packages/ai/src/commands/make-agent.ts`
- Modify: `packages/ai/src/index.ts` (or provider file — wherever boot() lives)
- Modify: `packages/ai/package.json` (add `rudderjs.make` field)

**Step 1: Create the make spec file**

```typescript
// packages/ai/src/commands/make-agent.ts
import type { MakeSpec } from '@rudderjs/rudder'

export const makeAgentSpec: MakeSpec = {
  command:     'make:agent',
  description: 'Create a new AI agent class',
  label:       'Agent created',
  suffix:      'Agent',
  directory:   'app/Agents',
  stub: (className) => `import { Agent } from '@rudderjs/ai'
import type { HasTools, AnyTool } from '@rudderjs/ai'

export class ${className} extends Agent implements HasTools {
  instructions(): string {
    return 'You are a helpful assistant.'
  }

  // model(): string | undefined { return 'anthropic/claude-sonnet-4-5' }

  tools(): AnyTool[] {
    return []
  }
}
`,
}
```

**Step 2: Register the spec in the provider's `boot()`**

In the AI provider's `boot()` method, add:

```typescript
try {
  const { registerMakeSpecs } = await import('@rudderjs/rudder')
  const { makeAgentSpec } = await import('./commands/make-agent.js')
  registerMakeSpecs(makeAgentSpec)
} catch { /* rudder not available */ }
```

**Step 3: Build and typecheck**

```bash
cd packages/ai && pnpm build && pnpm typecheck
```

### Task 2.2: Add make specs to `@rudderjs/mcp`

**Files:**
- Create: `packages/mcp/src/commands/make-mcp-server.ts`
- Create: `packages/mcp/src/commands/make-mcp-tool.ts`
- Create: `packages/mcp/src/commands/make-mcp-resource.ts`
- Create: `packages/mcp/src/commands/make-mcp-prompt.ts`
- Modify: `packages/mcp/src/provider.ts` (register specs in boot)

**Step 1: Create the 4 spec files**

Same pattern as Task 2.1 — move the stub functions from `packages/cli/src/commands/make/mcp-*.ts` into `MakeSpec` objects.

Each file exports a single `MakeSpec`:
- `make-mcp-server.ts` → `makeMcpServerSpec`
- `make-mcp-tool.ts` → `makeMcpToolSpec`
- `make-mcp-resource.ts` → `makeMcpResourceSpec`
- `make-mcp-prompt.ts` → `makeMcpPromptSpec`

**Step 2: Register all 4 in `McpServiceProvider.boot()`**

```typescript
try {
  const { registerMakeSpecs } = await import('@rudderjs/rudder')
  const { makeMcpServerSpec } = await import('./commands/make-mcp-server.js')
  const { makeMcpToolSpec } = await import('./commands/make-mcp-tool.js')
  const { makeMcpResourceSpec } = await import('./commands/make-mcp-resource.js')
  const { makeMcpPromptSpec } = await import('./commands/make-mcp-prompt.js')
  registerMakeSpecs(makeMcpServerSpec, makeMcpToolSpec, makeMcpResourceSpec, makeMcpPromptSpec)
} catch { /* rudder not available */ }
```

**Step 3: Build and typecheck**

```bash
cd packages/mcp && pnpm build && pnpm typecheck
```

### Task 2.3: Update CLI to collect make specs from registry

**Files:**
- Modify: `packages/cli/src/commands/make.ts`
- Delete: `packages/cli/src/commands/make/agent.ts`
- Delete: `packages/cli/src/commands/make/mcp-server.ts`
- Delete: `packages/cli/src/commands/make/mcp-tool.ts`
- Delete: `packages/cli/src/commands/make/mcp-resource.ts`
- Delete: `packages/cli/src/commands/make/mcp-prompt.ts`

**Step 1: Update `make.ts` to also register specs from the global registry**

After registering CLI-owned make commands, add:

```typescript
import { getMakeSpecs, executeMakeSpec } from '@rudderjs/rudder'
import chalk from 'chalk'

// Register make specs contributed by packages (ai, mcp, etc.)
for (const spec of getMakeSpecs()) {
  program
    .command(`${spec.command} <name>`)
    .description(spec.description)
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const result = await executeMakeSpec(spec, name, opts)
      if (!result.created) {
        console.error(chalk.red(`  ✗ Already exists: ${result.relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }
      console.log(chalk.green(`  ✔ ${spec.label}:`), chalk.cyan(result.relPath))
    })
}
```

**Step 2: Remove the 5 deleted files and their imports from `make.ts`**

Remove imports of `makeAgent`, `makeMcpServer`, `makeMcpTool`, `makeMcpResource`, `makeMcpPrompt` and their calls.

**Step 3: Build and test**

```bash
pnpm build  # from root
cd playground && pnpm rudder make:agent TestAgent
cd playground && pnpm rudder make:mcp-tool TestTool
```

**Important:** Since `make:*` commands skip boot, the package specs won't be registered via `boot()`. Two options:

**Option A (recommended):** CLI statically tries to import known package command modules before registering:

```typescript
// In make.ts, before getMakeSpecs():
const packageMakeModules = [
  '@rudderjs/ai/commands/make',
  '@rudderjs/mcp/commands/make',
]
for (const mod of packageMakeModules) {
  try { await import(mod) } catch { /* package not installed */ }
}
```

This requires each package to add a subpath export:
```json
// packages/ai/package.json exports
"./commands/make": { "import": "./dist/commands/make-agent.js" }
```

**Option B:** Don't skip boot for `make:agent` / `make:mcp-*` — only skip boot for the generic scaffolders. Add them to a `NEEDS_BOOT_PREFIX` set.

Choose Option A — it keeps boot skipping universal for `make:*` and follows the package-owns-its-commands principle.

---

## Phase 3: Move migrate commands to `@rudderjs/orm`

### Task 3.1: Move ORM detection + migrate logic to `@rudderjs/orm`

**Files:**
- Create: `packages/orm/src/commands/migrate.ts`
- Modify: `packages/orm/src/index.ts` (or whichever file has the ORM provider)

**Step 1: Create `packages/orm/src/commands/migrate.ts`**

Move the entire contents of `packages/cli/src/commands/migrate.ts` here. Replace `CliError` with a simple `Error` (or import from `@rudderjs/rudder` if we add it there). Remove `@clack/prompts` — use `console.log` like queue/schedule do.

The key functions to move:
- `detectORM()` — reads package.json to find prisma/drizzle
- `buildArgs()` — maps command names to ORM-specific CLI args
- `run()` — spawns shell command
- All 6 command registrations

**Step 2: Register commands in the ORM provider's `boot()`**

```typescript
// In the provider that packages/orm exports (or create one if it doesn't exist)
async boot(): Promise<void> {
  try {
    const { rudder } = await import('@rudderjs/rudder')
    const { registerMigrateCommands } = await import('./commands/migrate.js')
    registerMigrateCommands(rudder)
  } catch { /* rudder not available */ }
}
```

Where `registerMigrateCommands` wraps all 6 `rudder.command()` calls.

**Note:** `@rudderjs/orm` currently has no provider (it's just the Model base class). Two sub-options:

- **3.1a:** Add commands to `@rudderjs/orm-prisma`'s provider instead (since migrate is Prisma/Drizzle-specific). This is more accurate — `orm` is the abstraction, `orm-prisma` is the driver.
- **3.1b:** Keep in `@rudderjs/orm` with ORM detection logic (current approach in CLI).

**Recommendation:** Keep in `@rudderjs/orm` — the `detectORM()` function decides which driver to use, so it sits above both drivers. If `@rudderjs/orm` doesn't have a provider, the commands can self-register on import (like the make specs).

**Step 3: Build and test**

```bash
cd packages/orm && pnpm build && pnpm typecheck
pnpm build  # root
cd playground && pnpm rudder migrate:status
cd playground && pnpm rudder make:migration test_migration
```

### Task 3.2: Remove migrate commands from CLI

**Files:**
- Delete: `packages/cli/src/commands/migrate.ts`
- Modify: `packages/cli/src/index.ts` (remove import + `migrateCommands(program)`)

**Step 1: Remove import and call**

In `packages/cli/src/index.ts`, remove:
```typescript
import { migrateCommands } from './commands/migrate.js'
// ...
migrateCommands(program)
```

**Step 2: Remove `detectORM` import from `vendor-publish.ts`**

`vendor-publish.ts` imports `detectORM` from `migrate.ts`. This will be addressed in Phase 5 when vendor:publish moves to core. For now, inline the `detectORM` function in `vendor-publish.ts` or import from `@rudderjs/orm`.

**Step 3: Build and test**

```bash
pnpm build && cd playground && pnpm rudder migrate:status
```

---

## Phase 4: Move `route:list` to `@rudderjs/router` + `@rudderjs/view`

### Task 4.1: Add `route:list` command to `@rudderjs/router`

**Files:**
- Create: `packages/router/src/commands/route-list.ts`
- Modify: `packages/router/src/index.ts`

**Step 1: Create the command file**

Move the API route listing logic from `packages/cli/src/commands/route-list.ts`:
- `loadApiRoutes()` — calls `router.list()`
- `methodColor()`, `middlewareLabel()`, `printRoutes()` — formatting helpers
- The `--json` flag support

Register via `rudder.command('route:list', ...)` in the router's boot.

**Step 2: Integrate Vike page scanning from `@rudderjs/view`**

The `scanVikeRoutes()` function scans the `pages/` directory for `+Page.*` files. This belongs to `@rudderjs/view` since it understands the view/page mapping. Two approaches:

- **4.1a:** `@rudderjs/view` exports a `getPageRoutes()` function. The router's `route:list` command calls it if available (try/catch import).
- **4.1b:** `@rudderjs/view` registers its own sub-command or contributes to the route list via an event/hook.

**Recommendation:** 4.1a — router's `route:list` is the single command, it tries to import `@rudderjs/view` for page routes. Clean separation, single output.

**Step 3: Build and test**

```bash
pnpm build && cd playground && pnpm rudder route:list
pnpm rudder route:list --json
```

### Task 4.2: Remove `route-list.ts` from CLI

**Files:**
- Delete: `packages/cli/src/commands/route-list.ts`
- Modify: `packages/cli/src/index.ts` (remove import + `routeListCommand(program)`)

---

## Phase 5: Move `providers:discover` + `vendor:publish` to `@rudderjs/core`

### Task 5.1: Move providers:discover scanning logic to core

**Files:**
- Create: `packages/core/src/commands/providers-discover.ts`
- Modify: `packages/core/src/index.ts` (export the function)

**Step 1: Move the scanning + manifest-writing logic**

Extract `scanNodeModules()` and the manifest-writing logic into a function:

```typescript
export function discoverProviders(cwd: string): { manifest: ProviderManifest; sorted: ProviderEntry[] }
export function writeProviderManifest(cwd: string, manifest: ProviderManifest): void
```

The CLI wrapper becomes a thin shell that calls these two functions and prints output.

**Step 2: Register via `rudder.command()`**

Since `providers:discover` must skip boot, it cannot register in a provider's `boot()`. Instead:

- Core exports the functions
- CLI keeps a thin wrapper that imports from `@rudderjs/core` and registers the commander command
- The wrapper is in `NO_BOOT_EXACT` so it still skips boot

This is the one exception — `providers:discover` is a bootstrap chicken-and-egg command. The logic lives in core, but the CLI must wire it up directly.

### Task 5.2: Move vendor:publish logic to core

**Files:**
- Create: `packages/core/src/commands/vendor-publish.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Move the publish logic**

The `copyDir()` helper, ORM/driver detection, and publish registry reading move to core. The `detectORM()` function should come from `@rudderjs/orm` (or be duplicated minimally in core).

**Step 2: Register via `rudder.command()` in core's provider boot**

`vendor:publish` needs boot (reads `__rudderjs_publish_registry__` populated during provider boot), so it registers in `CoreServiceProvider.boot()`:

```typescript
rudder.command('vendor:publish', async (args) => {
  // ... moved logic
}).description('Publish package assets to your application')
```

### Task 5.3: Remove from CLI + update CLI wrappers

**Files:**
- Delete: `packages/cli/src/commands/vendor-publish.ts`
- Modify: `packages/cli/src/commands/providers-discover.ts` → slim down to call core's function
- Modify: `packages/cli/src/index.ts`

---

## Phase 6: Clean up CLI

### Task 6.1: Update `_shared.ts` to re-export from rudder

**Files:**
- Modify: `packages/cli/src/commands/make/_shared.ts`

Replace the local implementation with a re-export:

```typescript
export { MakeSpec, executeMakeSpec } from '@rudderjs/rudder'
// Keep registerMake for CLI-owned make commands (controller, model, etc.)
// that still use commander directly
```

### Task 6.2: Verify all commands still work

**Run from playground:**

```bash
# Scaffolders (skip-boot)
pnpm rudder make:controller Test
pnpm rudder make:agent Test
pnpm rudder make:mcp-tool Test

# Runtime commands
pnpm rudder route:list
pnpm rudder migrate:status
pnpm rudder command:list
pnpm rudder vendor:publish --list
pnpm rudder providers:discover

# Package-owned commands (already correct)
pnpm rudder queue:status
pnpm rudder schedule:list
pnpm rudder boost:install --help
```

Clean up any generated test files.

### Task 6.3: Remove stale dependencies from CLI

**Files:**
- Modify: `packages/cli/package.json`

After moving migrate.ts, `@clack/prompts` may only be needed by module commands. Check and remove if unused. The `@rudderjs/router` peer dep can be removed if route-list is gone.

### Task 6.4: Update CLAUDE.md

**Files:**
- Modify: `packages/cli/CLAUDE.md`
- Modify: `CLAUDE.md` (root — update architecture section)

Update to reflect that:
- CLI is the runner, not the command owner
- Packages register their own commands in `boot()` or via `MakeSpec`
- `providers:discover` logic lives in core, CLI wraps it
- List which packages own which commands

---

## Summary

After all phases, the CLI package contains:

**Owns directly:**
- `make:controller`, `make:model`, `make:job`, `make:middleware`, `make:request`, `make:provider`, `make:command`, `make:event`, `make:listener`, `make:mail` (generic scaffolders)
- `command:list` (CLI introspection)
- `module:make`, `module:publish` (module tooling)

**Thin wrappers (logic in other packages):**
- `providers:discover` (logic in `@rudderjs/core`)

**Auto-discovered from packages:**
- `make:agent` (from `@rudderjs/ai`)
- `make:mcp-*` (from `@rudderjs/mcp`)
- `migrate`, `migrate:*`, `db:*` (from `@rudderjs/orm`)
- `route:list` (from `@rudderjs/router`)
- `vendor:publish` (from `@rudderjs/core`)
- Plus all existing: `queue:*`, `schedule:*`, `boost:*`, `storage:link`, `live:*`, `broadcast:*`, `mcp:*`

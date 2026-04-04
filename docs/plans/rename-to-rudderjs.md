# Rename: RudderJS → RudderJS

## Overview
Rename the entire project from RudderJS to RudderJS across all packages, docs, configs, and references.

**New identity:**
- Framework: **RudderJS**
- npm scope: `@rudderjs/*`
- CLI command: `rudder` (replaces `rudder`)
- GitHub: `github.com/rudderjs`
- Domains: `rudderjs.com`, `rudderjs.store`
- Scaffolder: `create-rudderjs-app`

---

## Phase 0 — Safety
- [ ] Create branch: `rename/rudderjs`
- [ ] Ensure clean working tree (commit or stash any WIP)

---

## Phase 1 — Scope Assessment
Count occurrences of each pattern to understand the blast radius:

| Pattern | Case | Context |
|---------|------|---------|
| `@rudderjs/` | exact | npm scope in imports, package.json, deps |
| `rudderjs` | lower | package names, URLs, logger tags, event names, config keys |
| `RudderJS` | pascal | Display names, docs, comments, class names |
| `RUDDERJS` | upper | ENV vars (if any) |
| `rudderjs` | lower | GitHub org references |
| `rudder` | lower | CLI command, scripts, docs, code references |
| `create-rudderjs-app` | lower | scaffolder package name |

---

## Phase 2 — String Replacements (ordered)

### 2a — npm scope & package names
```
@rudderjs/  →  @rudderjs/
```
Files: every `package.json`, every `.ts` import, docs, README files.

### 2b — General references
```
rudderjs  →  rudderjs        (GitHub org)
RudderJS    →  RudderJS        (display name)
rudderjs    →  rudderjs        (lowercase: logger tags, event prefixes, metadata keys, URLs)
```

### 2c — CLI command & rudder package
```
rudder           →  rudder            (CLI binary name, scripts, docs, code)
pnpm rudder      →  pnpm rudder
CommandRegistry   →  CommandRegistry
rudder singleton →  rudder singleton  (+ Rudder alias)
Rudder alias     →  Rudder alias
__rudderjs_rudder__ → __rudderjs_rudder__
```

**`packages/rudder/`** — keep directory name, rename all exports:
- `@rudderjs/rudder` → `@rudderjs/rudder` (npm scope change only)
- `CommandRegistry` → `CommandRegistry`
- `export const rudder` → `export const rudder`
- `export const Rudder` → `export const Rudder`

**`packages/cli/`** — rename bin + branding:
- `bin.rudder` → `bin.rudder` in package.json
- `program.name('rudder')` → `program.name('rudder')`
- `"RudderJS Framework"` → `"RudderJS Framework"` in help output
- All `rudder` references in code → `rudder`

### 2d — Scaffolder
```
create-rudderjs-app  →  create-rudderjs-app
```
Dir rename + all internal references.

### 2e — Metadata keys & event names
```
rudderjs:controller:*    →  rudderjs:controller:*    (decorator metadata)
rudderjs:route:*         →  rudderjs:route:*
rudderjs/job.<Class>     →  rudderjs/job.<Class>     (Inngest events)
panel:<resource>:*       →  (keep? no rudderjs prefix here)
```

### 2f — Docs & CLAUDE.md
- All markdown files
- VitePress docs site
- CLAUDE.md (root + any nested)
- Memory files (`.claude/` project memory)

---

## Phase 3 — Directory & File Renames
- [ ] `create-rudderjs-app/` → `create-rudderjs-app/`
- [ ] `packages/rudder/` → decide: rename or keep
- [ ] Any other dirs with "rudderjs" in the name

---

## Phase 4 — Config & Build
- [ ] Update `pnpm-workspace.yaml` if dir names changed
- [ ] Update `turbo.json` if any package names are referenced
- [ ] Update `tsconfig.base.json` paths if any
- [ ] Update `.github/` workflows if any
- [ ] Update `.changeset/config.json`

---

## Phase 5 — Verify
- [ ] `pnpm install` (workspace resolution)
- [ ] `pnpm build` (all packages compile)
- [ ] `pnpm typecheck` (no broken imports)
- [ ] Playground `pnpm dev` works
- [ ] CLI `pnpm rudder` works
- [ ] Grep for any remaining `rudderjs` / `rudder` references

---

## Phase 6 — GitHub Migration
- [ ] Transfer repo: `rudderjs/rudder` → `rudderjs/rudder`
  - Settings → Danger Zone → Transfer ownership
  - GitHub auto-redirects old URL indefinitely
  - Update local remote: `git remote set-url origin git@github.com:rudderjs/rudder.git`
- [ ] Update repo description, homepage URL → `rudderjs.com`
- [ ] Delete or archive old `rudderjs` org (optional)

---

## Phase 7 — Publish New Packages
- [ ] Bump all packages to `0.1.0` (fresh start under new name)
- [ ] `pnpm build` from root
- [ ] `pnpm release` — publishes all `@rudderjs/*` to npm
- [ ] Publish `create-rudderjs-app` separately:
  ```bash
  cd create-rudderjs-app
  npm publish --access public
  ```
- [ ] Verify: `npm info @rudderjs/core` shows the new package

---

## Phase 8 — Deprecate Old npm Packages
Deprecate all 31 `@rudderjs/*` packages (do NOT unpublish — would break existing installs):

```bash
# Run for each package:
npm deprecate "@rudderjs/core@*" "Renamed to @rudderjs/core — install @rudderjs/core instead"
npm deprecate "@rudderjs/router@*" "Renamed to @rudderjs/router"
npm deprecate "@rudderjs/support@*" "Renamed to @rudderjs/support"
npm deprecate "@rudderjs/contracts@*" "Renamed to @rudderjs/contracts"
npm deprecate "@rudderjs/middleware@*" "Renamed to @rudderjs/middleware"
npm deprecate "@rudderjs/validation@*" "Renamed to @rudderjs/validation"
npm deprecate "@rudderjs/rudder@*" "Renamed to @rudderjs/rudder"
npm deprecate "@rudderjs/cli@*" "Renamed to @rudderjs/cli"
npm deprecate "@rudderjs/server-hono@*" "Renamed to @rudderjs/server-hono"
npm deprecate "@rudderjs/orm@*" "Renamed to @rudderjs/orm"
npm deprecate "@rudderjs/orm-prisma@*" "Renamed to @rudderjs/orm-prisma"
npm deprecate "@rudderjs/orm-drizzle@*" "Renamed to @rudderjs/orm-drizzle"
npm deprecate "@rudderjs/queue@*" "Renamed to @rudderjs/queue"
npm deprecate "@rudderjs/queue-inngest@*" "Renamed to @rudderjs/queue-inngest"
npm deprecate "@rudderjs/queue-bullmq@*" "Renamed to @rudderjs/queue-bullmq"
npm deprecate "@rudderjs/auth@*" "Renamed to @rudderjs/auth"
npm deprecate "@rudderjs/storage@*" "Renamed to @rudderjs/storage"
npm deprecate "@rudderjs/cache@*" "Renamed to @rudderjs/cache"
npm deprecate "@rudderjs/schedule@*" "Renamed to @rudderjs/schedule"
npm deprecate "@rudderjs/mail@*" "Renamed to @rudderjs/mail"
npm deprecate "@rudderjs/notification@*" "Renamed to @rudderjs/notification"
npm deprecate "@rudderjs/broadcast@*" "Renamed to @rudderjs/broadcast"
npm deprecate "@rudderjs/live@*" "Renamed to @rudderjs/live"
npm deprecate "@rudderjs/panels@*" "Renamed to @rudderjs/panels"
npm deprecate "@rudderjs/panels-lexical@*" "Renamed to @rudderjs/panels-lexical"
npm deprecate "@rudderjs/image@*" "Renamed to @rudderjs/image"
npm deprecate "@rudderjs/media@*" "Renamed to @rudderjs/media"
npm deprecate "@rudderjs/ai@*" "Renamed to @rudderjs/ai"
npm deprecate "@rudderjs/workspaces@*" "Renamed to @rudderjs/workspaces"
npm deprecate "@rudderjs/localization@*" "Renamed to @rudderjs/localization"
npm deprecate "@rudderjs/events@*" "Renamed to @rudderjs/events"
npm deprecate "@rudderjs/session@*" "Renamed to @rudderjs/session"
npm deprecate "create-rudderjs-app@*" "Renamed to create-rudderjs-app"
```

---

## Phase 9 — Post-Migration Cleanup
- [ ] Update `rudderjs.com` / `rudderjs.store` to point to new repo/docs
- [ ] Update any external links (social, blog posts, etc.)
- [ ] Update `CLAUDE.md` and memory files to reflect new names
- [ ] Verify `pnpm create rudderjs-app` works end-to-end

---

## Decisions (Resolved)
1. **`packages/rudder/` dir** → keep dir name, rename exports only (internal detail)
2. **`CommandRegistry` class** → `CommandRegistry` (more generic and accurate)
3. **`rudder` singleton** → `rudder` singleton + `Rudder` alias (public API: `rudder.command(...)`)
4. **`__rudderjs_rudder__` global key** → `__rudderjs_rudder__`
5. **`packages/cli/` bin field** → `"rudder": "./dist/index.js"` (the actual CLI command users type)
6. **`program.name('rudder')`** → `program.name('rudder')`
7. **`"RudderJS Framework"` in CLI help** → `"RudderJS Framework"`
8. **Decorator metadata keys** → `rudderjs:controller:*`, `rudderjs:route:*` (early dev, no real users to break)
9. **Inngest event prefix** → `rudderjs/job.*`
10. **BullMQ prefix** → `'rudderjs'`
11. **Backward compat exports** — keep `Rudder` / `rudder` as deprecated re-exports of `Rudder` / `rudder` for one release? **No** — early dev, clean break.

---

## Execution Strategy
- Use `sed` / bulk find-replace in a single pass per pattern
- Order matters: do `@rudderjs/` first (most specific), then `RudderJS`, then `rudderjs`
- Exclude: `node_modules/`, `dist/`, `.git/`, lock files
- Review diff before committing

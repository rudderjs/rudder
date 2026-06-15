# @rudderjs/vite

## 2.11.2

### Patch Changes

- dc3b293: Show Rudder first in the dev startup banner. `spliceRudderVersion()` now prepends the `Rudder v<x> ·` segment at the front of Vike's banner (before `Vike v<x>`) instead of inserting it just before `ready in`, so the line reads `Rudder v<x> · Vike v<x> · Vite v<x> · ready in <n> ms` — the framework brand the developer is running comes first. ANSI styling and the dim `·` separators are preserved; non-banner lines are still left untouched.

## 2.11.1

### Patch Changes

- c03a395: Harden the build-time view scanner against codegen injection and a client-side header leak.

  - **Filename / `export const route` values are validated before codegen.** The view id, import path, and route URL are interpolated verbatim into single-quoted string contexts inside the generated page modules (`+Page.tsx`, `+route.ts`, the typed registry). A view file with a crafted name (or route override) containing a quote, backtick, backslash, newline, or control char could break out of that string and corrupt — or inject code into — the generated source. Such views are now skipped with a warning instead of emitted; legitimate views (PascalCase names, slash-delimited routes) are unaffected.
  - **Symlinked entries under `app/Views/` are ignored.** A symlinked file could point out of the app tree and be ingested as a view (generating a page that imports an arbitrary out-of-tree file). The scanner now skips symlinks during discovery.
  - **`viewHeaders` is no longer serialized to the client.** The generated views-root config passed `['viewProps', 'viewHeaders']` to `passToClient`, shipping every controller response-header value — including per-request CSP nonces — into the client hydration payload for no consumer (`viewHeaders` is read only by the server-side `+headersResponse` hook). `passToClient` is now `['viewProps']` only.

## 2.11.0

### Minor Changes

- 6441725: Auto-generate the typed `config()` registry — no more hand-written `AppConfig` augmentation.

  `@rudderjs/core` already types `config('section.key')` over an `AppConfig` interface, but apps had to hand-write `declare module '@rudderjs/core' { interface AppConfig extends typeof configs {} }` to populate it. A new config scanner (sibling to the typed-env scanner) emits `.rudder/types/config.d.ts` augmenting `AppConfig` from the app's `config/index.ts` barrel via `import type` — so `config('app.name')` autocompletes and returns the real section type with zero boilerplate.

  The scanner runs in the same Vite generation pass as the env/routes scanners (dev + build), and ships a skip-boot `rudder config:sync` command to regenerate on demand. A missing `config/index.ts` removes any stale emit (symmetric shrink). Like the other registries, `.rudder/types/config.d.ts` is committed so `tsc` stays green on fresh clones.

### Patch Changes

- Updated dependencies [e8bd81f]
  - @rudderjs/core@1.11.0

## 2.10.0

### Minor Changes

- 24e25d7: The typed-`route()` registry moved from `pages/__view/routes.d.ts` to `routes/__registry.d.ts` — domain-adjacent to the route files it types (an API-only app no longer grows a `pages/` directory for it). Migration is automatic: the scanner deletes the legacy file when it writes the new one on your next dev / build / `rudder routes:sync` — commit the move. The scanner also no longer re-scans its own emit, and the dev re-boot watcher ignores the registry write (no chained second re-boot after a route edit).
- bef393f: Generated type registries consolidate under the committed `.rudder/types/` directory: `views.d.ts` (was `pages/__view/registry.d.ts`), `routes.d.ts` (was `routes/__registry.d.ts`), `models.d.ts` (was `app/Models/__schema/registry.d.ts`). The Vike page stubs stay in `pages/__view/` (pinned by Vike's filesystem routing).

  Migration is automatic — the first dev/build/`routes:sync`/`view:sync`/`migrate` after upgrading writes the new path and deletes the legacy file. One manual step for existing apps: add `".rudder/**/*"` to the `tsconfig.json` `include` array (dot-directories are invisible to `**/*` globs and to bare-directory include entries; new scaffolds ship it). A `.rudder/README.md` is generated alongside, describing each file and its regen command.

- 00e3b83: Typed `Env`: `Env.get('APP_NAME')` (and `getNumber`/`getBool`/`has`/`env()`) now autocompletes the keys your app declares. `@rudderjs/vite`'s new env scanner parses `.env.example` — the committed contract, never the secret `.env` — and emits `.rudder/types/env.d.ts` augmenting the new `EnvRegistry` interface in `@rudderjs/support`. Runs on dev/build, re-emits when `.env.example` changes, and the loose `string` overload stays for keys packages read that apps don't declare.

  New `rudder env:sync` command (skip-boot): regenerates the registry AND diffs `.env` against `.env.example` — missing keys are flagged, `--fix` appends them with their example values (or creates `.env` wholesale when absent). Keys only your `.env` carries are reported but never deleted.

### Patch Changes

- Updated dependencies [87783f7]
- Updated dependencies [940406d]
  - @rudderjs/core@1.8.0

## 2.9.1

### Patch Changes

- 1acf348: Fix the dev-banner splice losing the race on slow dev starts. The `rudderjs:banner` standalone-line fallback was armed from `configureServer` time, so apps taking >2s to reach Vike's startup banner (heavy `optimizeDeps.include`, codegen plugins) saw an early `➜ Rudder vX` line and a banner without the Rudder segment. The fallback is now armed from the http server's `listening` event (the banner prints on the next tick after it), keeping the old immediate arm in middleware mode, and the console.log wrapper is restored if the server closes before the banner ever matches.

## 2.9.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/core@1.7.0

## 2.8.0

### Minor Changes

- 67936de: Harmonize the dev startup output with Vike's banner.

  - `@rudderjs/vite` now splices `· Rudder vX.Y.Z` (name bold, in Rudder's brand
    orange) into Vike's startup line (`Vike v… · Vite v… · Rudder v1.5.1 · ready in
N ms`), reading the installed `@rudderjs/core` version. Falls back to printing
    its own line if Vike's banner format changes, so the version is never lost.
    Dev-only.
  - `@rudderjs/core`'s dev boot log is rendered as Vite-style `➜` lines that sit
    with `➜ Local`/`➜ Network` instead of the `├─└─` tree — `➜ Auto-discovered N
providers` and `➜ App is ready`. The per-stage provider breakdown is hidden by
    default and restored with `RUDDER_BOOT_VERBOSE=1`. Production keeps the
    parseable `[RudderJS] ready` prefix.
  - New `bootLine(message)` export from `@rudderjs/core` — print a `➜`-styled line
    from a provider's `boot()` so app/provider startup logs match the framework's
    banner. Plain (no arrow/ANSI) in production.

### Patch Changes

- 2d7a157: Style the dev HMR reload line to sit with Vite's. `[RudderJS] change detected —
reloading (file)` is now `<dim time> [Rudder] change detected <dim file>` —
  matching the shape of Vite's `<dim time> [vite] hmr update <dim files>`, with a
  bold orange `[Rudder]` tag.
- Updated dependencies [67936de]
  - @rudderjs/core@1.6.0

## 2.7.4

### Patch Changes

- eafdc7a: fix: close file check-then-write races (TOCTOU) in CLI scaffolders, the view/route scanners, and OAuth key generation

  Replaced `existsSync(path)` → later `write` patterns with a single atomic
  operation, so a concurrent process can't slip a file (or symlink) in between
  the check and the write:

  - **Scaffolders** (`make:*`, `make:module`, `rudder add`) now write with the
    exclusive `wx` flag and surface the same "already exists — use `--force`"
    message via an `EEXIST` catch. `--force` opts into truncation as before.
  - **`passport:keys`** writes the freshly generated keypair with `wx` (private
    key still `0o600`), so the write fails rather than following a pre-planted
    file/symlink at the key path. The non-`--force` guard now rejects when
    _either_ key already exists (previously only the private key), treating the
    pair atomically.
  - **`@rudderjs/vite` scanners** read-with-`ENOENT`-catch instead of
    `existsSync`-then-read for their idempotent codegen writes.

  No behavioral change for normal use; `--force` semantics are unchanged.

## 2.7.3

### Patch Changes

- ff64900: Fix the dev error page showing the wrong source line for thrown route handlers. In dev, route handlers run through Vite's SSR module runner as `eval`'d code, so V8 reports line numbers in transformed-code coordinates (a throw at source line 235 could surface as ~140) — and the Ignition page's text heuristic couldn't recover when the wrong line happened to land on unrelated real code, highlighting a completely different route.

  `@rudderjs/vite` now registers a dev-only `globalThis.__rudderjs_fix_stacktrace__` hook (Vite's `ssrFixStacktrace`), and `@rudderjs/server-hono` applies it to the error at the top of `onError` — before the app's error handler, the Ignition page, and logging all read the stack. The reported location, highlighted source line, stack frames, and any JSON debug trace now point at the true throw site. The existing line heuristic remains as a fallback for cases with no sourcemap remap (e.g. `tsx`-run CLI errors). No effect in production (the hook is only registered under `vite dev`).

- ac77c4f: Suppress the noisy Vite 8 dev-startup sourcemap warnings for `@rudderjs/*` packages. Each framework package ships a `dist/*.js.map` whose `sources` point at `../src/*.ts`; the pnpm workspace symlink makes Vite resolve that to the real `packages/<name>/src` path, which Vite 8 flags with `Sourcemap for "…" points to a source file outside its package` — one line per linked package on every `vike dev` boot. The maps are correct (they power accurate dev-error stack remapping); the warnings are benign. The `rudderjs:config` logger filter already suppressed the older `missing source files` wording — this extends it to the Vite 8 wording. Other packages' sourcemap warnings are still shown.
- Updated dependencies [649b819]
  - @rudderjs/core@1.5.0

## 2.7.2

### Patch Changes

- 2289785: Reset the page-context-enhancer registry on dev HMR re-boot. The registry is a persistent globalThis-backed append-only list, and three providers register an enhancer in `boot()` (auth → `user`, localization → `locale`, session → `flash`). Without a reset, each re-boot accumulated a duplicate enhancer per package per edit — unbounded growth, with every page render re-running each enhancer N times. `performReboot` now calls `resetPageContextEnhancers()` alongside clearing the app singletons, so the re-bootstrap re-registers them cleanly (mirrors the `router.reset()` contract). No-op in production (single boot).
- Updated dependencies [6f3cb2a]
  - @rudderjs/core@1.4.0

## 2.7.1

### Patch Changes

- ae30176: Dev HMR: fix half-booted responses served during the re-bootstrap window.

  Editing an `app/`, `routes/`, or `bootstrap/` file in dev triggers a full re-bootstrap. Requests that landed **while that async re-boot was still in flight** could be served against a half-booted app and render empty data — e.g. resource tables showing their empty-state ("No records yet") despite rows in the DB, while pure-config changes reflected fine. An editor's atomic-write / format-on-save made it reliable: the second write fired a _second_ concurrent re-boot that interleaved its `router.reset()` / provider boot / `ModelRegistry.set()` with the first.

  Three independent fixes close the window:

  - **`@rudderjs/vite` — debounce the watcher.** A burst of `change` events (atomic-write / format-on-save double-fire) is now coalesced into a single re-boot, removing the reliable trigger. One save = one reload.
  - **`@rudderjs/core` — single-flight the re-bootstrap.** Concurrent re-boots are chained via a promise on `globalThis.__rudderjs_boot__` and run strictly serially, so one boot never observes another mid-reset.
  - **`@rudderjs/core` — gate request handling on boot completion.** `handleRequest()` blocks on the latest in-flight re-boot before invoking the route handler, so in-window requests wait for a fully-booted graph instead of observing half-booted shared state. In production (a single boot) and in the steady state this is a no-op.

- Updated dependencies [ae30176]
  - @rudderjs/core@1.3.1

## 2.7.0

### Minor Changes

- 93742eb: Dev HMR: add a `watch` option to hot-reload linked/workspace packages, and fix a routes-loss regression in the scoped invalidation.

  **`rudderjs({ watch: ['@scope/pkg'] })`** — watch extra packages (or absolute dirs) for dev HMR. Editing a watched package's source now re-bootstraps the app like an `app/` edit, with no server restart — for packages that register routes, views, or config in a service provider's `boot()`. Package-name entries are also added to `ssr.noExternal` **in dev only**, so Vite owns them in the SSR module graph and re-evaluates them on change (Node's ESM import cache can't be evicted, so an externalized package would otherwise keep re-reading its stale source). Resolution is exports-agnostic — it finds the package directory without tripping `ERR_PACKAGE_PATH_NOT_EXPORTED` on ESM-only packages — and resolves through pnpm/workspace symlinks to the realpath.

  **Fix (regression from the scoped-invalidation change):** the dev re-boot calls `router.reset()` and re-runs the route loaders, which re-import `routes/*.ts`. After scoped invalidation, a backend edit that didn't touch a route's import chain (a `bootstrap/`, `config/`, or unrelated `app/` file) left those route modules cached, so they never re-ran their registration and every loader-registered route 404'd until a route file was edited or the server restarted. The route loader modules are now always re-evaluated on a re-boot.

### Patch Changes

- 44bef3c: Dev HMR: scope SSR invalidation to the edited file's import subtree instead of dumping the whole module graph. On a backend edit (`routes/`, `bootstrap/`, `app/`), the `rudderjs:routes` plugin now invalidates only the changed file + its transitive importers (up to the bootstrap entry), leaving framework packages and unrelated app modules warm — so Vike's runner re-fetches far less on the next request. Measured on the playground: edit-to-ready dropped from ~1.1s to ~75ms (`watcher→reimport` ~911ms → ~45ms). Falls back to the previous whole-graph invalidation when the changed file isn't tracked in the SSR graph, so behaviour is never worse. Dev-only; no production-build or API change.

## 2.6.0

### Minor Changes

- b6753fe: feat(vite): detect the `vike-react-rsc-rudder` renderer (and keep upstream name)

  The view scanner now recognizes `vike-react-rsc-rudder` (RudderJS's maintained
  fork of vike-react-rsc) as the RSC renderer, alongside the legacy upstream
  `vike-react-rsc` name. Both map to the same `react-rsc` mode, and having both
  installed is treated as the same renderer (no false "multiple renderers" error).

  The generated server-component page stub now imports `getPageContext` from
  **whichever** RSC package is installed (`vike-react-rsc-rudder/pageContext`
  preferred, falling back to `vike-react-rsc/pageContext`), so apps on either name
  keep working.

  Opt-in / experimental — the default `vike-react` whole-page-hydration model is
  unchanged.

## 2.5.0

### Minor Changes

- 7710545: feat(vite): detect the `vike-react-rsc` renderer (React Server Components)

  The view scanner now recognizes `vike-react-rsc` as a renderer alongside
  `vike-react` / `vike-vue` / `vike-solid`. When it is the installed renderer, the
  generated `app/Views/**` page is a React **server component** that reads
  pageContext via `getPageContext()` from `vike-react-rsc/pageContext` — the
  `usePageContext()` hook throws under the `react-server` condition. The
  controller still injects `viewProps`, so `view('id', props)` keeps working.

  `vike-react` and `vike-react-rsc` are mutually exclusive (both are React
  renderers) — installing both raises the existing multiple-renderers error.

  Opt-in / experimental: install `vike-react-rsc` instead of `vike-react`. The
  default whole-page-hydration `vike-react` model is unchanged.

- b58db48: feat(vite): RSC-compatible routes + framework hooks in the view scanner

  When `vike-react-rsc` is the renderer, the view scanner now:

  - pins each view's route via an inlined `route` value in its `+config.ts`
    instead of a separate `+route.ts` module, and
  - wires the RudderJS framework hooks (`onCreatePageContext`, `onError`,
    `headersResponse`) via Vike `import:` strings in the generated view-root
    `+config.ts` rather than physical `pages/+<hook>.ts` re-export stubs.

  Both avoid `vike-react-rsc`'s client-bundle exclusion, which strips server-only
  `+*.ts` project modules to `export default {}` — that otherwise broke Vike's
  client router (route read as an object) and crashed hydration (the global
  `onCreatePageContext` hook lost its export). Leaf-dir detection is now
  framework-agnostic (any `+Page.*`, not only `+route.ts`).

  No change for the `vike-react` / `vike-vue` / `vike-solid` renderers.

### Patch Changes

- 45745c7: fix(vite): dynamic-prerender codegen no longer fails `tsc` for the array form

  The generated `+onBeforePrerenderStart.ts` called the imported `prerender`
  symbol directly inside a `typeof source === 'function'` guard. When a view
  declared `export const prerender = ['/a', '/b']` (a literal URL array), TS
  narrowed the function branch to `never`, so `source()` raised
  `TS2349: This expression is not callable`. The hook now normalizes the symbol
  to a callable-or-array union before the runtime guard, so all three documented
  forms (array, sync function, async function) type-check.

## 2.4.1

### Patch Changes

- 29d0d79: Vite scanners no longer false-positive on commented-out declarations. Three fixes in the same class:

  - **`ROUTE_EXPORT_RE`** in `views-scanner.ts` — anchored at `^export` (multiline flag) so a commented `// export const route = '/old-path'` doesn't get picked up as the active route override. Previously the `[\s;]` alternative matched the space after `//`, silently swapping the view's URL to a stale value with no error surface.
  - **`PROPS_EXPORT_RE`** in `views-scanner.ts` — same `^export` anchor. A commented `// export interface Props { … }` no longer fools the scanner into emitting a `registry.d.ts` entry that imports a non-existent type (which would break tsc on the next compile).
  - **`routes-scanner.ts`** — new `stripJsComments()` pass strips `//` line comments + `/* … */` block comments before the named-routes regex runs. A commented `// Route.get('/admin', h).name('admin')` no longer populates `RouteRegistry` with a name that has no runtime registration backing it (which would let `route('admin')` type-check but throw). String literals are preserved (the stripper tracks single-/double-/template-quote state), so URLs like `Route.get('https://example.com/api', h).name('proxy')` keep their `//` characters intact.

  Same fix shape as `PRERENDER_DECL_RE` in #620. No public API changes; existing regex matches that aren't inside comments behave unchanged.

## 2.4.0

### Minor Changes

- a464418: View scanner now supports **dynamic prerender** for parameterized routes — enumerate the URLs to materialize at build time straight from the view file:

  ```tsx
  // app/Views/Blog/Post.tsx
  export const route     = '/blog/@slug'
  export const prerender = ['/blog/hello-world', '/blog/another-post']
  // Or async for DB-driven slugs:
  // export const prerender = async () => prisma.post.findMany(...).then(...)

  export default function Post() { … }
  ```

  `pnpm build` writes one static HTML per enumerated URL. The static `export const prerender = true` form (Phase 1) continues to work unchanged — both modes share the same exported name; the scanner picks the right output based on the RHS shape.

  Sync arrays, sync functions, and async functions are all accepted. Vike's full `OnBeforePrerenderStart` return shape passes through — string URLs or `{ url, pageContext }` entries for per-URL props.

  Detection is anchored to the start of a logical line, so `export const prerender = […]` appearing inside a string (e.g. a documentation snippet in a /demos card) doesn't false-positive as the actual top-level export.

## 2.3.0

### Minor Changes

- fbcdf93: Add a routes scanner that auto-populates `@rudderjs/router`'s `RouteRegistry` interface from `.name('foo')` calls in `routes/*.ts`.

  ```ts
  // routes/web.ts
  Route.get("/users/:id", usersShow).name("users.show");

  // Anywhere:
  route("users.show", { id: 1 }); // ✓ types-check
  route("users.show", {}); // ✗ TS: missing 'id'
  route("users.shwo", { id: 1 }); // ✗ TS: unknown route name
  ```

  Mechanism: the new `routesScannerPlugin` (auto-registered by `rudderjs()`) walks `routes/*.ts` (and nested subdirs), regex-extracts `(verb, path, name)` triples from chains like `Route.<verb>('path', ...).name('foo')`, and emits `pages/__view/routes.d.ts` augmenting the `RouteRegistry` interface. Watches the routes directory for changes and re-emits incrementally.

  **Picks up**: literal-path AND literal-name chains on the same expression. Multi-line tolerant. Negative-lookahead in the regex ensures a chain without `.name()` followed later by a different chain that DOES name a route can't silently bridge.

  **Does not pick up** (intentional, documented):

  - Variable paths (`router.get(loginPath, ...).name('login')`)
  - Variable names (`.name(LOGIN_ROUTE_NAME)`)
  - Routes registered inside helper functions (e.g. `registerAuthRoutes(router)`) — those live in package source and run at boot time. Apps that need them in `RouteRegistry` hand-augment the interface manually; the scanner's emit merges with manual augmentations via declaration merging.

  Also adds a `routes:sync` CLI command (`pnpm rudder routes:sync`) for one-shot regeneration outside of Vite — useful in CI (typecheck-before-build) and on fresh clones before the first `pnpm dev`. Skip-boot, so it works before `@prisma/client` etc. exist.

- 42fab4c: Scanner gains `export const prerender = true` opt-in for `app/Views/**` files. When set, the scanner emits a `+prerender.ts` next to the generated `+Page.*`, so `pnpm build` writes the pre-rendered HTML to `dist/client/<url>/index.html` and the production server serves it before falling back to SSR.

  Build-time only — dev still SSRs every request. Suitable for views with no per-request data: landing pages, docs index, terms / privacy / 404. Detected via the same multiline-tolerant regex pattern used for `export const route`, so it works in Vue SFCs too (tolerant of `: boolean` annotation).

  The generated `+prerender.ts` is removed automatically when a source file flips the export off in a subsequent scan — symmetric with `+route.ts` content updates.

  Phase 2 (dynamic prerender: `export const prerender = () => [...slugs]` with `onBeforePrerenderStart`) is a follow-up. Auth-guarded views are intentionally incompatible — the flag is per-view opt-in, off by default.

## 2.2.1

### Patch Changes

- 6b3aced: Skip framework re-bootstrap in dev when `app/Views/**` files change. View files are loaded lazily by Vike per-request and aren't captured in provider boot closures, so the singleton-clear + SSR invalidate + full-reload that other `app/` edits need is wasted work for view edits.

  The `rudderjs:routes` watcher previously fired the same heavy path for every file under `routes/`, `bootstrap/`, and `app/` — including views — which forced cold SSR on the next request (~600–750 ms measured on the playground) and prevented Vike's component HMR from firing. Now view edits fall through to Vike's native HMR path (≈50 ms component refresh in the browser; ~240–280 ms if the user issues a fresh request, vs ~700 ms before).

  Non-view `app/` edits (models, controllers, providers, services, jobs, …) still trigger the full re-bootstrap — those _are_ captured in closures and need it.

## 2.2.0

### Minor Changes

- 377212d: Add `rudder view:sync` command that regenerates `pages/__view/` (Vike stubs + `registry.d.ts` + `+config.ts`) from `app/Views/` without starting Vite. Useful when `tsc` runs in CI before any Vite step (typecheck-before-build order), on a fresh clone before the first dev server boot, or after manually clearing `pages/__view/`. Idempotent — safe to call repeatedly. Pass `--json` for machine-readable output.

  Also exposes `syncViewsFromDisk()` from `@rudderjs/vite/commands/view-sync` for programmatic use by tooling that needs to materialize the registry without booting the dev server.

  `view:sync` skips `bootApp()` (same pattern as `providers:discover`) so it works on apps that can't yet boot — exactly the scenarios it's designed for.

## 2.1.0

### Minor Changes

- 15925ac: Typed views: `view('id', props)` now type-checks against the receiving component's exported `Props` type. Opt in per view by adding `export interface Props` (or `export type Props`) to the view file — the scanner emits `pages/__view/registry.d.ts` mapping the id to the prop shape, and the controller call site is checked at compile time. Apps that don't adopt the convention keep working unchanged; the loose `view(id, props?)` overload still accepts any record-shaped props. Stubs for React / Solid / Vue `+Page` files use the per-view `Props` type when available so intellisense propagates into the rendered component. Vanilla views are intentionally excluded (their props are typed at the function argument already).

## 2.0.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 2.0.0

### Major Changes

- 4ce1e09: **Breaking — `rudderjs()` no longer registers Vike.** You must add `vike()` to your `vite.config.ts` plugins array yourself.

  Previously, `rudderjs()` dynamically imported `vike/plugin` inside its own async IIFE and prepended Vike's plugins to its return value. That wrapped Vike's plugin IIFE inside ours and tripped a microtask race against Vike's `isOnlyResolvingUserConfig` flag in `loadViteConfigFile` — failing deterministically on Ubuntu Node 20 and ~50% on Ubuntu Node 22 CI runners with the misleading `[vike@…][Bug] You stumbled upon a Vike bug` error wrapper. Upstream discussion: vikejs/vike#3258.

  **Migration — two-line diff:**

  ```diff
    import { defineConfig } from 'vite'
  + import vike from 'vike/plugin'
    import rudderjs from '@rudderjs/vite'
    // …

    export default defineConfig({
      plugins: [
        rudderjs(),
  +     vike(),
        // …
      ],
    })
  ```

  Note the order: **`rudderjs()` before `vike()`**. The views-scanner writes auto-generated stubs to `pages/__view/` during plugin construction, and Vike scans `pages/` during its own construction, so the stubs must exist before `vike()` is called.

  Other API changes:

  - `rudderjs()` now returns `Plugin[]` synchronously instead of `Promise<Plugin[]>`. Existing `await rudderjs()` calls continue to work (await on a non-Promise is a no-op), but TypeScript signatures change.
  - The `_vikeVitePluginOptions` self-detection marker is no longer attached to the return value — we don't register Vike, so there's nothing to flag.
  - `vike` is still listed in `peerDependencies` and remains required.

## 1.1.0

### Minor Changes

- 937cdac: Adopt three Vike framework-author hooks landed in 2025 for unified DX:

  - **`+onCreatePageContext`** — `@rudderjs/vite` now ships a process-wide page-context enhancer registry. Framework packages register a function via `registerPageContextEnhancer(fn)` and it runs on every page render. The first user: `@rudderjs/auth` populates `pageContext.user` automatically — views no longer need a `+data.ts` to read the current user. The augmentation is typed via the `Vike.PageContext` global namespace.

  - **`+onError`** — Vike SSR errors are now routed through `@rudderjs/core`'s `report()` so they hit the same reporter/renderer chain as HTTP route errors. `@rudderjs/core` is an optional peer; the hook falls back to `console.error` when it's not installed.

  - **`+headersResponse`** — `view('id', props, { headers })` is the new third arg. Pass per-page response headers (`Cache-Control`, CSP, etc.) directly from the controller. The headers can be a plain object or a function (`() => Record<string, string>`) for per-request values like CSP nonces. Framework-owned headers (`set-cookie`, `vary`, anything starting with `x-rudderjs-`) are silently dropped to prevent collisions with server-hono's response pipeline.

  ### Mechanism

  The Vike hooks are wired by the `@rudderjs/vite` views scanner — it writes three one-line re-export stubs to `pages/+onCreatePageContext.ts`, `pages/+onError.ts`, and `pages/+headersResponse.ts` on first sync. These files are user-overwritable: re-running the scanner won't clobber edits. (Vike's `Config.extends` mechanism doesn't support scoped packages, so the scanner generates files that Vike picks up via its native page discovery instead.)

  ### Migration

  - Existing apps: run `pnpm dev` or `pnpm build` once. The scanner emits the three hook stubs to `pages/` automatically. Commit them. No code changes required.
  - The `pages/__view/+config.ts` scanner output now also adds `viewHeaders` to `passToClient`, so view components can read response-header context if they need to.
  - `pageContext.user` types automatically when both `@rudderjs/auth` and `@rudderjs/vite` are installed.

  ### Out of scope (deferred follow-ups)

  - `@rudderjs/session` flash enhancer (`pageContext.flash`) — adopt the same `registerPageContextEnhancer` pattern.
  - `@rudderjs/localization` locale enhancer (`pageContext.locale`) — same shape.
  - Typed `+rudderRoute` meta — current `export const route = '/...'` works.
  - `+onHookCall` (beta) telescope integration — wait until telescope's request collector is stable.

  ### No API breaks

  - `view(id, props)` (2-arg) still works; the `options` arg is optional.
  - `req.user` flow on HTTP routes is unchanged.
  - No new required dependencies; `@rudderjs/core` is added as an optional peer of `@rudderjs/vite`, and `@rudderjs/vite` is added as an optional peer of `@rudderjs/auth`.

## 1.0.2

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.
- 6c93f36: Add `@rudderjs/orm-prisma` to SSR externals, fix WS pending-buffer socket leak on 10s timeout (destroy queued sockets rather than silently dropping them), fix HMR log missing closing `)`, and correct boost/guidelines.md plugin name (`rudderjs:views` → `rudderjs:views-scanner`) and ORM externals list.

## 1.0.1

### Patch Changes

- 285ac77: fix: auto-generated `+Page.tsx` stub uses `ReactNode` from `react` instead of
  the global `JSX.Element`. The global `JSX` namespace was removed in
  `@types/react@19`; the previous stub only typechecked when an older copy of
  `@types/react` happened to be hoisted into a path TypeScript walks. Fresh
  installs against React 19 now typecheck cleanly without that accident.

## 1.0.0

### Major Changes

- 1d81533: Graduate to 1.0.0.

  The `rudderjs()` Vite plugin is now stable. Calling it returns the full plugin bundle that powers every RudderJS app:

  - `rudderjs:config` — SSR externals for server-only packages, `@/` and `App/` path aliases
  - `rudderjs:ip` — dev-only `x-real-ip` header injection from the Node socket
  - `rudderjs:ws` — WebSocket upgrade handler shared by `@rudderjs/broadcast` and `@rudderjs/sync`
  - `rudderjs:routes` — HMR watcher that invalidates SSR modules and clears framework singletons when `routes/`, `bootstrap/`, or `app/` changes
  - `rudderjs:views` — view scanner that discovers `app/Views/**` and generates Vike pages under `pages/__view/`, with auto-detection for `vike-react` / `vike-vue` / `vike-solid` / vanilla HTML-string mode

  Every playground build and every scaffolded app has exercised this plugin daily — the API has been frozen-in-practice for some time. 1.0 just makes that contract explicit.

## 0.0.7

### Patch Changes

- 3a1e5c7: Renamed `@rudderjs/live` → `@rudderjs/sync` and extracted Lexical-specific helpers into the `@rudderjs/sync/lexical` subpath. `@rudderjs/sync/tiptap` subpath is scaffolded as a contract-only stub for the upcoming Tiptap adapter.

  **Breaking — `@rudderjs/sync`:**

  - Package renamed: `@rudderjs/live` → `@rudderjs/sync` (`@rudderjs/live` is deprecated on npm with a pointer to the new name)
  - Facade renamed: `Live` → `Sync`; provider renamed: `LiveProvider` → `SyncProvider`
  - Type/interface renames: `LiveConfig` → `SyncConfig`, `LivePersistence` → `SyncPersistence`, `LiveEvent` → `SyncEvent`, `LiveObserver` → `SyncObserver`, `LiveObserverRegistry` → `SyncObserverRegistry`, `LiveClientProvider` → `SyncClientProvider`, `RedisLivePersistenceConfig` → `RedisSyncPersistenceConfig`
  - Factory renamed: `live()` → `sync()`
  - Helper renames: `livePrisma` → `syncPrisma`, `liveRedis` → `syncRedis`, `liveObservers` → `syncObservers`
  - WebSocket default path: `/ws-live` → `/ws-sync`
  - Config key + DI bind: `'live'` → `'sync'`, `'live.persistence'` → `'sync.persistence'`
  - CLI commands: `live:docs` / `live:clear` / `live:inspect` → `sync:docs` / `sync:clear` / `sync:inspect`
  - Prisma model default: `'liveDocument'` → `'syncDocument'` — rename your `LiveDocument` model to `SyncDocument`, or pass `syncPrisma({ model: 'liveDocument' })` explicitly to keep the old table
  - Redis key prefix default: `'rudderjs:live:'` → `'rudderjs:sync:'` — pass `syncRedis({ prefix: 'rudderjs:live:' })` to keep the old prefix
  - Lexical block helpers (`Live.editBlock` / `insertBlock` / `removeBlock`, `Live.editText` / `rewriteText` / `editTextBatch`, `Live.setAiAwareness` / `clearAiAwareness`, `Live.readText`) moved to `@rudderjs/sync/lexical` as standalone functions. Use `sync.document(name)` to get the `Y.Doc` handle, then pass it to the helper:

    ```ts
    import { sync } from "@rudderjs/sync";
    import { editBlock, insertBlock } from "@rudderjs/sync/lexical";

    const doc = sync.document("panel:articles:42:richcontent:body");
    insertBlock(doc, "callToAction", { title: "Subscribe" });
    ```

  **New — `@rudderjs/sync`:**

  - `sync.document(name)` accessor on the `Sync` facade returns the underlying `Y.Doc` for use with editor adapters
  - `YDoc` type re-exported from `@rudderjs/sync` (`export type { Doc as YDoc } from 'yjs'`)
  - `@rudderjs/sync/lexical` subpath: editor-agnostic Yjs core + Lexical-specific helpers separated for the first time
  - `@rudderjs/sync/tiptap` subpath: scaffolded contract for Tiptap adapter (throws at runtime until implemented)

  **Breaking — `@rudderjs/telescope`:**

  - `LiveCollector` → `SyncCollector`
  - Telescope entry type slug `'live'` → `'sync'` (URL `/telescope/live/...` becomes `/telescope/sync/...`; existing entries tagged `'live'` won't appear under the new tab)
  - Config keys: `recordLive` → `recordSync`, `liveAwarenessSampleMs` → `syncAwarenessSampleMs`

  **Patch — `@rudderjs/vite`, `@rudderjs/broadcast`:**

  Comment + guideline updates for the WS upgrade chaining (now references `@rudderjs/sync` instead of `@rudderjs/live`).

  **Patch / minor — `create-rudder-app`:**

  The `--packages` multi-select option `live` → `sync`; generated `config/live.ts` → `config/sync.ts`; generated Prisma model `LiveDocument` → `SyncDocument`. Existing scaffolded projects keep working — only new scaffolds use the renamed surface.

  **Sibling repos:** `pilotiq` and `pilotiq-pro` need their own PRs to update `pnpm.overrides` link targets (`link:../rudder/packages/live` → `link:../rudder/packages/sync`) and dynamic-import strings. See `docs/plans/2026-04-26-rename-live-to-sync.md` Phase 7.

## 0.0.6

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

## 0.0.4

### Patch Changes

- Add database driver packages (`pg`, `mysql2`, `better-sqlite3`, `@prisma/adapter-*`, `@libsql/client`) to SSR externals so they are never bundled into the client build.

## 0.0.3

### Patch Changes

- Suppress "Sourcemap points to missing source files" warnings for @rudderjs/\* packages in dev server output

## 0.0.2

### Patch Changes

- Fix `virtual:` ESM URL scheme error when scaffolded app serves pages

  Add `@rudderjs/server-hono` to `ssr.noExternal` so Vite processes it through its module runner rather than loading it natively. When loaded natively, its dynamic `import('@photonjs/hono')` also loads `@photonjs/hono` natively, which causes static imports of `virtual:photon:get-middlewares:*` virtual modules to fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. This fix ensures the virtual import is handled by Vite's plugin system.

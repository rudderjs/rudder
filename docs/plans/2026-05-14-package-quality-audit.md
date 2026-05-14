# Package quality cleanup — view, vite, terminal, mail, notification, broadcast

> **Status:** shipped 2026-05-14 — PR A (#445), PR B (#446), PR C (#447), peer-resolution fix + tests (#448), and the three deferred test-infra items (this PR) all merged.
> **Date:** 2026-05-14
> **Scope:** internal cleanup of six packages that weren't covered by the 2026-05-13 audit wave (framework #418–#421, mcp #424–#426, ai #410/#411, orm #413–#416). No public API breaks expected. No latent bugs found that warrant patch-bumps.
>
> **Companion:** continuation of the cleanup arc — see `2026-05-13-framework-quality-audit.md` and `2026-05-13-mcp-quality-audit.md` for the prior waves' shape.

---

## TL;DR

Six packages audited via parallel Explore agents (view 279 LOC, vite 1228 LOC, terminal 107 LOC, mail 1255 LOC, notification 358 LOC, broadcast 967 LOC). Findings cluster into three PRs:

| Prior analogue | This wave | Packages touched |
|---|---|---|
| #424 / #418 (docs + bugs) | **PR A** — JSDoc on hidden contracts | all six |
| #421 (tests) | **PR B** — test-coverage gap fill | all six |
| #420 (file split) | **PR C** — `mail/index.ts` NodemailerAdapter extraction + cast tightening | mail, notification, vite |

**Expected deltas:**
- ~17 JSDoc additions on load-bearing invariants nobody had captured
- ~14 new test files / extensions (mail leading with 6)
- `mail/index.ts`: 315 → ~215 LOC after extracting `NodemailerAdapter` + its config types/guard
- 3 `as unknown as` casts removable (notification, vite test, mail `_subject`)

**Reviewer-flagged "bugs" verified as false positives** — listed in "What's NOT in this plan" so future audits don't re-flag them.

Run after each PR's last commit:
```bash
pnpm --filter @rudderjs/<pkg> typecheck && pnpm --filter @rudderjs/<pkg> test
```

---

## Pre-flight (run once before starting)

```bash
git checkout main && git pull --ff-only
pnpm install
pnpm build
pnpm typecheck    # expect clean
pnpm test         # expect green across all packages
```

---

## PR A — JSDoc on hidden contracts

Smallest-diff PR. Pure documentation — no behavior change, no cast tightening.

**Branch:** `cleanup/2026-05-14-package-quality-pr-a`

### A1 — view: Vike pageContext contract on `ViewResponse.toResponse()`

**File:** `packages/view/src/index.ts:112–132`

The method depends on Vike's `renderPage()` returning a context with optional `errorWhileRendering` (error path) or `httpResponse` (success path). The casts on lines 123–124 and 127–132 are necessary but hide the dependency. Document the assumed shape so a future Vike upgrade doesn't silently break the 404 fallback.

### A2 — view: reserved-header filtering on `view()` options

**File:** `packages/view/src/index.ts:52–54, 58–70`

JSDoc currently says "framework-owned headers are dropped" but doesn't enumerate which ones (`set-cookie`, `vary`, `x-rudderjs-*`) or why (collision with session/CSRF cooperative writes, see `feedback_set_cookie_collapse.md`). Add the list + rationale.

### A3 — view: `SafeString` constructor pre-sanitization

**File:** `packages/view/src/index.ts:222–225`

The class-level JSDoc warns about XSS, but the constructor itself isn't tagged. `new SafeString(userInput)` is the foot-gun. Add a sentence on the constructor: "Constructor does not escape — caller must pre-sanitize via `escapeHtml()` or equivalent."

### A4 — vite: `__rudderjs_http_upgrade_patched__` sentinel

**File:** `packages/vite/src/index.ts:124–126`

The sentinel coordinates with `@rudderjs/server-hono`'s module-load HTTP-upgrade patch — both attach upgrade listeners, and `handleUpgrade()` would fire twice for the same socket without it. The block comment above explains the *why* but not the contract (sentinel slot name, who reads it, who writes it). Add JSDoc above the slot.

### A5 — vite: framework-detection lazy init in `views-scanner.ts`

**File:** `packages/vite/src/views-scanner.ts` — `getFramework()` accessor

Lazy initialization is load-bearing: scaffolder projects with multiple `vike-*` packages installed but no `app/Views/` directory would crash on a top-level detect call. Add JSDoc on the accessor explaining the lazy intent.

### A6 — vite: `writeIfChanged()` idempotent write

**File:** `packages/vite/src/views-scanner.ts` — `writeIfChanged()`

The compare-then-write pattern avoids spurious Vite invalidations during `buildStart()` + the watcher hook. Load-bearing for watch stability. Add JSDoc.

### A7 — terminal: `terminal()` async semantics

**File:** `packages/terminal/src/terminal.ts:23–28`

Returns when the Ink component calls `useApp().exit()` (or the process receives SIGINT). Throws on render failure or missing default export. Callers from `routes/console.ts` need to know whether to wrap in `try/catch`. Add JSDoc.

### A8 — terminal: extension resolution order in `resolveComponent()`

**File:** `packages/terminal/src/resolve.ts:5, 23`

`EXTENSIONS = ['.tsx', '.ts', '.js', '.mjs']` resolves stop-at-first-match. Worth noting the order is deliberate (TS/TSX preferred for IDE support) — future maintainers may add `.cts`/`.mts` and need to know precedence matters.

### A9 — mail: `MailPendingSend` fluent contract

**File:** `packages/mail/src/index.ts:46–83`

`.cc()` and `.bcc()` *replace* the previous set, not accumulate. Order of `.subject()` / `.with()` / `.send()` is free, but `.send()` / `.queue()` must be last. Add JSDoc on each builder method clarifying.

### A10 — mail: `FakeMailAdapter.recordQueued()` is internal

**File:** `packages/mail/src/fake.ts:34–35`

The method is a stub for future queue integration — `dispatchMailJob` doesn't call it today. Tag `@internal` + JSDoc: "Hook for queue integration; called by the queue dispatcher when it wires through `MailRegistry`."

### A11 — mail: `FailoverAdapter` retry window never auto-clears

**File:** `packages/mail/src/failover.ts:22–28, 36–38`

`_lastFailures` is set on every error and never cleaned. A mailer that fails once is gated for the full `retryAfter` window even if the underlying issue resolves immediately. Not a bug — intended backoff — but surprising. JSDoc the contract.

### A12 — notification: `AnonymousNotifiable.route()` email side-effect

**File:** `packages/notification/src/index.ts:103–105`

`route('mail', address)` mutates `this.email`. Load-bearing for `MailChannel` (which reads `notifiable.email` at line 159) but invisible from the call site. JSDoc on `route()`.

### A13 — notification: `ChannelRegistry` mutable global state

**File:** `packages/notification/src/index.ts:123–141`

Singleton with module-level state. Tests must call `reset()` between runs or pollution leaks. JSDoc + warn against production calls to `reset()`.

### A14 — notification: `NotificationFake.restore()` asymmetry

**File:** `packages/notification/src/fake.ts:112`

`restore()` resets `Notifier.send` but leaves `_sent` populated. Use a fresh fake per test or call `.reset()` manually. JSDoc.

### A15 — broadcast: fire-and-forget `onMessage`

**File:** `packages/broadcast/src/ws-server.ts:147–155`

`void onMessage(...)` is intentional — sequential awaits would serialize subscribe-then-publish into a multi-RTT chain. JSDoc the trade-off.

### A16 — broadcast: `matchPattern()` wildcard semantics

**File:** `packages/broadcast/src/ws-server.ts:87–92`

`*` matches exactly one dot-separated segment (not `**` recursive globs). The regex `[^.]+` substitution encodes that. JSDoc + an example: `chat.*` matches `chat.room1` but not `chat.room1.replies`.

### A17 — broadcast: observer-error swallow

**File:** `packages/broadcast/src/observers.ts:85–94`

`emit()` wraps each subscriber in try/catch with a silent fallthrough — observability must never break broadcasts. Not a bug. JSDoc the contract on `subscribe()` so future authors don't expect exceptions to propagate.

### A-Verify

```bash
pnpm typecheck    # full repo
pnpm test         # full repo
```

**PR title:** `docs: JSDoc hidden contracts across view, vite, terminal, mail, notification, broadcast`
**Changeset:** none. Pure docs.

---

## PR B — Test-coverage gap fill

**Branch:** `cleanup/2026-05-14-package-quality-pr-b`

### B1 — view: `ViewResponse.toResponse()` integration tests

**File:** `packages/view/src/index.test.ts` — extend

Mock Vike's `renderPage()` to exercise the three paths: success (returns Response with viewHeaders merged), error (rethrows `errorWhileRendering`), 404 (no `httpResponse`).

### B2 — vite: plugin behavior tests

**File:** `packages/vite/src/index.test.ts` — extend

Stub `configureServer` with a fake Vite server.
- `rudderjs:ip` injects `x-real-ip` from `req.socket.remoteAddress`.
- `rudderjs:routes` watcher invalidates SSR modules + clears `__rudderjs_app__` / `__rudderjs_instance__` on change.
- `rudderjs:ws` polling: pending buffer flushes when `__rudderjs_ws_upgrade__` appears; sockets `.destroy()` after the 10s timeout.

### B3 — terminal: `resolveComponent()` tests

**File:** `packages/terminal/src/index.test.ts` — extend

Create fixture files in a temp dir.
- Happy path: each extension (`.tsx`, `.ts`, `.js`, `.mjs`) resolves
- `.tsx` precedence when both `.tsx` and `.ts` exist
- Missing file → "not found" error with expected path
- File exists but no default export → throws the dedicated error

### B4 — mail: 6 new test files

**Files:**
- `packages/mail/src/failover.test.ts` — order, first-success short-circuit, all-fail aggregation, retryAfter skip, empty-adapters edge case
- `packages/mail/src/markdown.test.ts` — markdown→HTML (headers, lists, links), component blocks (`@component('button', {...})`), variable interpolation, malformed JSON in attrs (silent today — confirm or fix), theme override
- `packages/mail/src/preview.test.ts` — happy-path render, error path, response status codes
- `packages/mail/src/queued.test.ts` — `@rudderjs/queue` peer-missing error, queue options builder, `handle()` sends via adapter
- `packages/mail/src/fake.test.ts` — `assertSent`/`assertQueued` (positive + negative), predicate filtering, multi-target dispatch
- Extend `packages/mail/src/index.test.ts` for `NodemailerAdapter` — lazy nodemailer load, `from` address formatting (name + address), missing peer error

**Update `packages/mail/package.json` test script** — currently hardcodes `node --test dist-test/index.test.js`. Change to a glob so new files auto-pick-up. Memory note: only orm, queue, router enumerate explicitly; mail is not in that list (per `feedback_orm_test_script_explicit_files`), so the glob is safe.

### B5 — notification: 5 new test paths

**File:** `packages/notification/src/index.test.ts` — extend (script is explicit single-file, no rename needed)

- `BroadcastChannel.send` — peer-missing error; happy path with stubbed `broadcast()`
- `ShouldQueue` notification: `_sendQueued` builds correct `{queue, delay}` opts, dispatches via QueueRegistry
- `isQueueable` — true for `{shouldQueue: true}`, false for `{shouldQueue: false}`, false for missing prop
- `AnonymousNotifiable.route('mail', addr)` sets `this.email`; `routeFor('broadcast')` round-trips; multi-channel routes
- `NotificationFake` with array of notifiables — fake records each, `assertSentTo` filters correctly

### B6 — broadcast: new test files

**Files:**
- `packages/broadcast/src/observers.test.ts` — registry singleton, `subscribe()` returns unsubscribe, `emit()` error-swallow, `reset()` clears
- `packages/broadcast/src/provider.test.ts` — boot reads config, registers upgrade handler on `globalThis.__rudderjs_ws_upgrade__`

`packages/broadcast/package.json` test script is glob-based — new files auto-run.

### B-Verify

```bash
pnpm typecheck
pnpm test
pnpm lint
```

**PR title:** `test: fill coverage gaps in view, vite, terminal, mail, notification, broadcast`
**Changeset:** none. Test-only.

---

## PR C — Mail extraction + cast tightening

**Branch:** `cleanup/2026-05-14-package-quality-pr-c`

### C1 — Extract `NodemailerAdapter` to sibling

**File:** `packages/mail/src/index.ts` → `packages/mail/src/nodemailer-adapter.ts`

Move (~110 LOC):
- `NodemailerConfig` interface
- `NodemailerTransportConfig`
- `isNodemailerConfig` guard
- `NodemailerAdapter` class + its lazy require/import for `nodemailer`

`packages/mail/src/index.ts` re-exports for back-compat.

### C2 — Tighten `isQueueable` cast

**File:** `packages/notification/src/index.ts:79`

Before:
```ts
if ((notification as unknown as ShouldQueue).shouldQueue === true) {
```
After (typed guard):
```ts
function isQueueable(n: Notification): n is Notification & ShouldQueue {
  return 'shouldQueue' in n && (n as { shouldQueue?: unknown }).shouldQueue === true
}
```

### C3 — Tighten `vite` test cast

**File:** `packages/vite/src/index.test.ts:17`

`rudderjs() as any` → `rudderjs() as Promise<Plugin[]>` so the test verifies plugin-array shape.

### C4 — Drop `_subject` cast in `MarkdownMailable`

**File:** `packages/mail/src/markdown.ts:131`

Expose a `getSubject()` accessor on the base `Mailable` class (or make `_subject` readonly-public) so the child reads through a proper method, removing the `as unknown as { _subject: string }` cast.

### C-Verify

```bash
pnpm --filter @rudderjs/mail typecheck && pnpm --filter @rudderjs/mail test
pnpm --filter @rudderjs/notification typecheck && pnpm --filter @rudderjs/notification test
pnpm --filter @rudderjs/vite typecheck && pnpm --filter @rudderjs/vite test
pnpm typecheck    # full repo
```

Cast-count check:
```bash
grep -rn "as unknown as" packages/{mail,notification,vite}/src/ | grep -v test.ts | wc -l
```

Expect 3 fewer than baseline.

**PR title:** `refactor: extract NodemailerAdapter sibling; tighten 3 casts (notification, vite, mail)`
**Changeset:** none. Internal refactor.

---

## What's NOT in this plan

Three findings flagged by audit agents that turn out to be **false positives** — listed so future audits don't re-flag them:

| Finding | Verdict | Reason |
|---|---|---|
| `vite/src/index.ts:131–166` — pending-queue race | Not a bug | Check + push at lines 163–167 are in the same synchronous block (`else if (pending) { pending.push(...) }`). JS event-loop guarantees the timeout cannot interrupt between them. |
| `terminal/src/resolve.ts:31–46` — over-broad catch swallows import errors | Not a bug | The catch filters: `if (e.code === 'ENOENT') continue; throw e`. Real `import()` errors (`ERR_MODULE_NOT_FOUND`, `SyntaxError`) propagate immediately. |
| `notification/src/index.ts:233` — `BroadcastChannel` drops async errors | Not a bug | `@rudderjs/broadcast`'s `broadcast()` is declared `: void` (synchronous) at `packages/broadcast/src/ws-server.ts:326`. Nothing to await. |

Other items the audit agents proposed but deferred:

| Item | Why deferred |
|---|---|
| Split `vite/src/views-scanner.ts` (454 LOC) into discovery + stubs + io | File is coherent as-is; split adds friction without leverage |
| Split `vite/src/index.ts` (290 LOC) plugins into siblings | Same reasoning |
| Split `notification/src/index.ts` channels into `src/channels/` | Same reasoning |
| Split `broadcast/src/ws-server.ts` (365 LOC) into helpers + auth-registry | Borderline; defer unless the file grows |
| Inlined HTML helpers in telescope/pulse/horizon | Tracked as post-vike-split followup (`feedback_broadcast_split_future.md`-adjacent) |
| `globalThis as Record<string, unknown>` consolidation in broadcast | 11 instances, all justified; type alias would only save readability |
| Tightening structural `Vike pageContext` casts in `view` | Necessary while Vike's types lack the optional fields |

---

## Sequencing

Recommended order: **A → B → C**.

- A is independent; can land first.
- B can land in parallel with A (new files + extensions; no symbol moves).
- C touches `mail/src/index.ts` re-exports + `notification/src/index.ts` callsites — easier to land after A's JSDoc settles in those files.

---

## Wrap-up

After all three PRs land:

```bash
pnpm typecheck && pnpm test && pnpm lint
git log --oneline main..HEAD -- packages/{view,vite,terminal,mail,notification,broadcast}/ | head
```

**Risk notes:**
- A is pure docs; reviewer load is *reading*, not running.
- B touches test infrastructure but no shipped code paths. Watch for mail's test-script update — currently single-file, switching to a glob.
- C does a public-API-stable file extraction; `mail/index.ts` re-exports must cover every previously-exported symbol from `NodemailerAdapter`. Verify via `git diff main -- packages/mail/src/index.ts | grep '^-export'`.

---

## Follow-up — deferred test-infra items (2026-05-14, same-day)

PR B deferred three tests that needed Vike or nodemailer module-mocking infrastructure. Picked up same day after a brief investigation:

- **Node 22 across CI + local** confirmed (`actions/setup-node@v4` with `node-version: 22`), so `node:test`'s `mock.module()` is viable behind `--experimental-test-module-mocks`. Verified with a smoke test before writing the real ones.
- **`mailPreview()` does not actually touch Vike** — the original deferral memo overstated the dependency. It's a pure HTML-string handler with a stubbed `res` interface, so no module mocking is needed for that file.

Test files added / extended:

| Item | File | Approach |
|---|---|---|
| view: `ViewResponse.toResponse()` paths | `packages/view/src/index.test.ts` (+10 tests) | `mock.module('vike/server', { namedExports: { renderPage } })` |
| mail: `mailPreview()` | `packages/mail/src/preview.test.ts` (new, 11 tests) | stub `res` recorder; no module mock |
| mail: `NodemailerAdapter` SMTP path | `packages/mail/src/nodemailer-adapter.test.ts` (new, 18 tests) | `mock.module(<resolved file:// URL>, ...)` — keyed on the URL form because `resolveOptionalPeer` calls `createRequire().resolve()` first, and Node normalizes the cache key to the URL |

Test-script updates to pass `--experimental-test-module-mocks`:
- `packages/view/package.json` — also switched from explicit single-file `node --test dist-test/index.test.js` to a glob (no new files yet, but the script wouldn't have picked them up).
- `packages/mail/package.json` — flag only; script was already a glob.

**Gotchas learned (write to memory once shipped):**
- `mock.module()` cannot be installed twice for the same target — "already mocked" — and `mock.reset()` does **not** unregister module mocks. Install at module scope, not inside a `before()` hook (which Node 22 runs once per top-level describe, not once per file).
- Node normalizes import specifiers to `file://` URLs internally. Mocking the absolute path form *also* works (it's silently aliased), but mocking *both* forms throws the duplicate-mock guard — pick one.
- For peers loaded via `resolveOptionalPeer`, the fast path is `createRequire(cwd).resolve(specifier)` → absolute path → `import()`. So a `mock.module('nodemailer', ...)` mock by bare specifier **does not** intercept; mock by resolved path/URL.

All three audit packages green; pre-existing lint warnings untouched. `boost` has an unrelated flaky exit-code assertion that fails on `main` too — outside this scope.

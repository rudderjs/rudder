# MCP code-quality cleanup — @rudderjs/mcp

> **Status:** in progress 2026-05-13
> **Date:** 2026-05-13
> **Scope:** internal cleanup of `@rudderjs/mcp` (2364 LOC). No public API breaks. One behavior fix (inspector streaming-tool serialization). Follows the ORM #413–#417 + framework #418–#421 pattern.
>
> **Companion:** continuation of the 2026-05-13 cleanup arc — see `2026-05-13-framework-quality-audit.md` for the prior wave.

---

## TL;DR

`@rudderjs/mcp` audited after the framework cleanup arc finished. Findings cluster into three PRs:

| ORM/framework analogue | mcp equivalent | Files touched |
|---|---|---|
| #413 / #418 (docs + bugs) | **PR A** — docs + dedup + inspector bug | `runtime.ts`, `commands/inspector.ts`, `McpServer.ts`, `auth/oauth2.ts`, `provider.ts` |
| #414 / #419 + #420 (index split) | **PR B** — `runtime.ts` split into siblings | `runtime.ts` (488 LOC) |
| #415–#416 / #421 (casts + tests) | **PR C** — cast tightening + inspector/transport tests | all |

**Expected deltas:**
- `runtime.ts`: 488 → ~120 LOC barrel (−75%) after extracting sdk-server, http-transport, handle-deps siblings
- Removable `as unknown as`: 4 confirmed (`runtime.ts:51`, `commands/inspector.ts:142`, `testing.ts:15` — all the `getProtected` casts collapse once `McpServer` exposes `@internal` accessors)
- New test files: 2 (`commands/inspector.test.ts`, runtime SDK-handler tests added inline)
- One latent bug fixed: streaming tools called via `mcp:inspector` currently serialize the iterator object as `{}` instead of consuming it.

Run after each PR's last commit:
```bash
pnpm --filter @rudderjs/mcp typecheck && pnpm --filter @rudderjs/mcp test
```

---

## Pre-flight (run once before starting)

```bash
git checkout main && git pull --ff-only
pnpm install
pnpm build
pnpm --filter @rudderjs/mcp typecheck
pnpm --filter @rudderjs/mcp test    # baseline must be green
```

---

## PR A — Docs + latent bug fixes + helper dedup

Smallest-diff PR. One real bug fix (A4), three dedup edits (A2/A3), JSDoc additions on hidden contracts.

**Branch:** `docs/mcp-quality-fixes`

### A1 — `McpServer`: expose `@internal` accessors for tools/resources/prompts

**File:** `packages/mcp/src/McpServer.ts:21-29`

The runtime + inspector + testing helper all reach through the `protected` arrays via `as unknown as Record<string, T>` casts (3 sites). The arrays are intentionally protected from public consumers but the framework's own runtime needs them. Add `@internal`-tagged accessors so the casts disappear in PR C:

```ts
/** @internal — runtime/inspector/testing only. Do not call from user code. */
_tools(): (new () => McpTool)[]    { return this.tools }
/** @internal */
_resources(): (new () => McpResource)[] { return this.resources }
/** @internal */
_prompts(): (new () => McpPrompt)[]     { return this.prompts }
```

Why methods, not getters: keeps the call sites visually consistent with the existing `metadata()` / `attachedCount()` accessors and signals "framework-internal" the same way.

This commit only adds the accessors; call sites flip to them in PR C.

### A2 — Dedupe `matchUriTemplate` between runtime and inspector

**Files:** `packages/mcp/src/runtime.ts:34`, `packages/mcp/src/commands/inspector.ts:215`

Same regex-based template matcher in both files (one named `matchUriTemplate`, the other `matchTemplate`). Move to `packages/mcp/src/uri-template.ts`, export, import from both call sites.

### A3 — Dedupe `getProtected` (split deferred to PR B)

Two copies (`runtime.ts:50`, `commands/inspector.ts:141`). Since PR C will delete both call sites once `McpServer` exposes `_tools()/_resources()/_prompts()`, **no dedup edit in PR A** — just leave a JSDoc note on the runtime copy: `// @internal — to be replaced by McpServer._tools() etc. in PR C.`

### A4 — Inspector streaming-tool bug

**File:** `packages/mcp/src/commands/inspector.ts:188-194`

```ts
async function callTool(entry: ServerEntry, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { tools } = instantiateServer(entry)
  const tool = tools.find((t) => t.name() === name)
  if (!tool) throw new Error(`Tool "${name}" not found on ${entry.label}`)
  const extras = resolveHandleDeps(tool, 'handle')
  return tool.handle(input, ...extras as [])    // ← BUG: returns iterator for streaming tools
}
```

Streaming tools (`async *handle()` — see `McpTool.ts:50-56`) return an `AsyncGenerator`. `JSON.stringify(iterator)` produces `{}`. Inspector users running a streaming tool see an empty response.

**Fix:** use `consumeToolReturn` from `runtime.ts` (same path the SDK + test client take). Progress yields are dropped silently when no `progressToken` is supplied, which is fine for the inspector — it's an interactive tool, not a streaming client. A future enhancement could surface progress in the UI, but that's out of scope.

```ts
async function callTool(entry: ServerEntry, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { tools } = instantiateServer(entry)
  const tool = tools.find((t) => t.name() === name)
  if (!tool) throw new Error(`Tool "${name}" not found on ${entry.label}`)
  const extras = resolveHandleDeps(tool, 'handle')
  const ret = tool.handle(input, ...extras as [])
  return consumeToolReturn(ret, undefined, undefined)
}
```

Already imported `resolveHandleDeps` from `../runtime.js`; add `consumeToolReturn` to the same import line.

### A5 — JSDoc on `mountHttpTransport` session lifecycle

**File:** `packages/mcp/src/runtime.ts:405-487`

Document the stateless-vs-stateful path split, when `sessions.set()` fires (`onsessioninitialized`), and the `detach` closure pattern (the `let detach: () => void = () => {}` warts are load-bearing, not a hack).

### A6 — JSDoc on `oauth2McpMiddleware` + `loadPassport` memoization

**File:** `packages/mcp/src/auth/oauth2.ts:32-45`

`loadPassport` memoizes the resolveOptionalPeer call in a module-level promise. On failure, the promise is cleared so the next call retries — undocumented and not obvious from the `.catch` block. Add JSDoc.

### A7 — JSDoc on `inspector.ts` per-request instantiation

**File:** `packages/mcp/src/commands/inspector.ts:145-156`

`instantiateServer` is called once per inspector request (describe/callTool/readResource/getPrompt each call it independently). Stateful tools (those holding instance state across calls) won't observe that state. Worth a JSDoc note so future maintainers don't add stateful behavior expecting it to persist.

### A-Verify

```bash
pnpm --filter @rudderjs/mcp typecheck
pnpm --filter @rudderjs/mcp test
pnpm --filter @rudderjs/mcp lint
pnpm typecheck    # full repo — telescope/collectors/mcp.ts imports via @rudderjs/mcp/observers, should stay clean
```

**PR title:** `fix(mcp): consume streaming-tool returns in inspector; document hidden contracts; dedupe uri-template helper`
**Changeset:** `@rudderjs/mcp` patch — "Inspector now correctly consumes streaming-tool generators (previously returned `{}`)."

---

## PR B — Split `runtime.ts`

**Branch:** `refactor/mcp-runtime-split`

`runtime.ts` is 488 LOC: a mix of SDK-handler wiring (~180 LOC), HTTP transport mounting (~85 LOC), DI helpers (~70 LOC), and small utilities. Clean extraction along functional lines.

| Phase | New file | Symbols | Approx LOC out |
|---|---|---|---|
| B1 | `src/runtime/sdk-server.ts` | `createSdkServer`, `startStdio` (stdio is a 7-LOC wrapper around `createSdkServer`) | ~200 |
| B2 | `src/runtime/http-transport.ts` | `mountHttpTransport`, `HttpTransportOptions` | ~100 |
| B3 | `src/runtime/handle-deps.ts` | `resolveHandleDeps`, `resolveOrConstruct`, `getContainer`, `Ctor` type | ~70 |
| B4 | `src/runtime/consume-tool-return.ts` | `consumeToolReturn`, `SdkRequestExtra` | ~45 |
| B5 | `src/runtime/observers-accessor.ts` | `getMcpObservers` lazy accessor | ~12 |

After extraction, `runtime.ts` becomes a re-export barrel preserving the public API surface:

```ts
export { createSdkServer, startStdio } from './runtime/sdk-server.js'
export { mountHttpTransport, type HttpTransportOptions } from './runtime/http-transport.js'
export { consumeToolReturn } from './runtime/consume-tool-return.js'
export { resolveHandleDeps, isRegistered, filterRegistered } from './runtime/handle-deps.js'
```

The `uri-template.ts` extraction happened in PR A; PR B just imports from it.

Expected: `runtime.ts` 488 → ~20 LOC (barrel only).

### B0 — Pre-flight

```bash
cd packages/mcp
pnpm typecheck && pnpm test    # expect green
```

### B1 — Extract `src/runtime/sdk-server.ts`

Move `createSdkServer` + `startStdio`. Helpers `isRegistered` / `filterRegistered` move to `handle-deps.ts` in B3 (they're tiny but conceptually about registration filtering, not SDK wiring). The `SdkRequestExtra` type follows `consumeToolReturn` to B4.

### B2 — Extract `src/runtime/http-transport.ts`

Move `mountHttpTransport` + `HttpTransportOptions`. Keep the dynamic `@rudderjs/core` + `@rudderjs/router` imports — they're load-bearing for circular-dep avoidance (memory: `feedback_dynamic_import_silent_catch` warns against silent catches but these have load-bearing async behavior). Add JSDoc clarifying that.

### B3 — Extract `src/runtime/handle-deps.ts`

Move `resolveHandleDeps`, `resolveOrConstruct`, `getContainer`, `Ctor`, `RudderContainer`, `isRegistered`, `filterRegistered`. Watch for the `getInjectTokens` import from `../decorators.js` — relative path becomes `../../decorators.js` after the move.

### B4 — Extract `src/runtime/consume-tool-return.ts`

Move `consumeToolReturn` + `SdkRequestExtra`. Pure function, no other dependencies inside the package.

### B5 — Extract `src/runtime/observers-accessor.ts`

Move `_mcpObs` + `getMcpObservers`. Same singleton-lazy-accessor pattern as `@rudderjs/ai/observers` (memory: `reference_observer_registry_pattern`).

### B-Risk notes

- **`testing.ts` imports from `./runtime.js`** — keep `runtime.ts` as a barrel so this import stays valid.
- **`commands/inspector.ts` imports `resolveHandleDeps` from `../runtime.js`** — same barrel reasoning.
- **`provider.ts` imports `mountHttpTransport` + `startStdio` from `./runtime.js`** — same barrel reasoning.
- **`telescope/src/collectors/mcp.ts` imports `@rudderjs/mcp/observers`** — subpath unchanged. PR B doesn't touch observer paths.

### B-Verify (end of phase)

```bash
pnpm --filter @rudderjs/mcp typecheck
pnpm --filter @rudderjs/mcp test
pnpm --filter @rudderjs/mcp build
pnpm --filter @rudderjs/mcp lint
pnpm typecheck    # full repo
```

Public API check:
```bash
git diff main -- packages/mcp/src/runtime.ts | grep '^-export' | head
```
Every `-export` should reappear as a `+export ... from './runtime/<file>.js'` line. Net zero public surface change.

**PR title:** `refactor(mcp): split runtime.ts into sdk-server, http-transport, handle-deps, consume-tool-return siblings`
**Changeset:** none. Internal refactor.

---

## PR C — Cast tightening + missing test coverage

**Branch:** `chore/mcp-casts-and-tests`

### C1 — Flip 3 `getProtected` call sites to `McpServer._tools()` etc.

**Files:**
- `packages/mcp/src/runtime/sdk-server.ts` (post-B1)
- `packages/mcp/src/commands/inspector.ts:152-154`
- `packages/mcp/src/testing.ts:15-27`

Before:
```ts
const toolClasses = getProtected<(new (...args: any[]) => McpTool)[]>(server, 'tools', [])
```
After:
```ts
const toolClasses = server._tools()
```

Delete `getProtected` from `sdk-server.ts` and `commands/inspector.ts` once the call sites flip. Removes **3 `as unknown as` casts** (one per file) and 2 helper definitions.

### C2 — Drop `consumeToolReturn` iterator cast

**File:** `packages/mcp/src/runtime/consume-tool-return.ts` (post-B4)

```ts
// Before
const maybeIter = ret as unknown as { [Symbol.asyncIterator]?: unknown; next?: unknown }
```
Replace with a typed guard:
```ts
function isAsyncGen(v: unknown): v is AsyncGenerator<McpToolProgress, McpToolResult, unknown> {
  return typeof v === 'object' && v !== null
    && typeof (v as { next?: unknown }).next === 'function'
    && typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}
```
The typed guard removes one `as unknown as`, replaces it with a narrower `as { next?: unknown }` (locally needed for the structural check). Net: one less `as unknown as`.

### C3 — Inspector tests

**New file:** `packages/mcp/src/commands/inspector.test.ts`

Test through the dispatch surface (the HTTP server is a thin wrapper around `handle()`; test the underlying helpers and a few full request flows by stubbing `IncomingMessage`/`ServerResponse`):

- `listServers()` returns web + local entries with `Server: undefined`
- `resolveServer('web:/path')` resolves the registered entry; unknown key → `undefined`
- `describeServer()` includes inputSchema, outputSchema (when present), template flag on resources
- `callTool` with a plain async tool → returns the `McpToolResult`
- `callTool` with a streaming tool → drains the generator and returns the final result (this is the A4 regression test)
- `callTool` on unknown tool → throws
- `readResource` on static URI → matches by exact URI
- `readResource` on template URI → matches via `matchUriTemplate` and passes extracted params
- `getPrompt` returns `{ messages: [...] }`

Update `package.json` `test` script — mcp's test script is `node --test dist-test/*.test.js` (glob), so new test files pick up automatically. **No explicit-file update needed** (mcp isn't in the orm/queue/router list from `feedback_orm_test_script_explicit_files`).

### C4 — `createSdkServer` SDK-handler tests

**File:** `packages/mcp/src/index.test.ts` (extend existing).

The existing tests cover `McpTestClient` (which bypasses the SDK) and `consumeToolReturn` (which is one step lower). The actual SDK request handlers wired by `createSdkServer` — `ListToolsRequestSchema`, `CallToolRequestSchema`, `ReadResourceRequestSchema`, etc. — are never exercised. Build a minimal in-process roundtrip using `Server` + `Client` from the MCP SDK with an `InMemoryTransport` pair.

If that's too heavy, fall back to invoking `createSdkServer(server)` and directly calling the registered handlers via `sdk.assertCanSetRequestHandler` / the SDK's private handler map. Spec the test for the public path first; descope to private-handler probing only if the in-memory transport adds too much.

Minimum coverage:
- `tools/list` returns name/description/inputSchema/annotations
- `tools/call` happy path returns the tool result
- `tools/call` on unknown tool returns `isError: true` with "Unknown tool"
- `tools/call` failure path returns `isError: true` and emits `tool.failed` observer event
- `resources/read` happy path on static URI
- `resources/read` on template URI passes params through
- `resources/read` on unknown URI throws
- `prompts/list` + `prompts/get` happy paths

### C5 — `oauth2` happy-path test

**File:** `packages/mcp/src/index.test.ts` — extend `describe('oauth2McpMiddleware', ...)`.

The two existing tests only cover failure paths (no token; passport not installed). Add:

- Valid token with no required scopes → `next()` called, no challenge issued
- Valid token with required scope present → `next()` called
- Valid token missing a required scope → 403 `insufficient_scope` with `scope=` in WWW-Authenticate
- Valid token but `revoked: true` → 401 `invalid_token`
- Wildcard scope `*` on token bypasses required-scope check
- `registerOAuth2Metadata` emits a JSON body with `resource`, `authorization_servers`, `bearer_methods_supported` + `scopes_supported` when set

Mock `loadPassport` by stubbing the module-level promise to a fake `PassportModule`:
```ts
;(await import('./auth/oauth2.js') as unknown as { __setPassportForTest?: (m: unknown) => void }).__setPassportForTest?.(fakePassport)
```
…**or** simpler: export an internal `_setPassportForTest` test seam:
```ts
// auth/oauth2.ts — added export
export function _setPassportForTest(m: PassportModule | null): void {
  passportPromise = m ? Promise.resolve(m) : null
}
```
Tag with `@internal`. Tests reset between runs via `beforeEach`.

### C6 — `mountHttpTransport` test

**File:** `packages/mcp/src/index.test.ts`

Hardest path to test in isolation (depends on the MCP SDK's WebStandard transport and a router). Minimum:

- `mountHttpTransport` without `@rudderjs/router` installed → resolves silently (`resolveOptionalPeer` throws, caught at the `provider.boot()` level). Test by stubbing `resolveOptionalPeer`.
- Stateless mode (`sessionIdGenerator: undefined`) → reuses a single transport for all requests.
- Stateful mode → spins a transport per session, removes on `onsessionclosed`.

If the SDK transport requires a real HTTP server, skip C6 — the integration's tested in the playground manually. Document the skip in the plan's "What's NOT in this plan" section.

### C-Verify

```bash
pnpm --filter @rudderjs/mcp typecheck
pnpm --filter @rudderjs/mcp test
pnpm --filter @rudderjs/mcp lint
pnpm typecheck    # full repo
```

Cast count check:
```bash
grep -rn "as unknown as" packages/mcp/src/ | grep -v test.ts | wc -l
```
Expect 4 fewer than baseline (9 → 5): C1 removes 3, C2 removes 1.

**PR title:** `refactor(mcp): tighten casts via McpServer accessors; add inspector + SDK-handler + oauth2 happy-path tests`
**Changeset:** `@rudderjs/mcp` patch — only if C1's `_tools()/_resources()/_prompts()` accessors should be advertised in the changelog. They're `@internal`, so a changeset isn't strictly required. Default to no changeset.

---

## What's NOT in this plan

These came up in the audit but are deliberately out of scope:

| Item | Why deferred |
|---|---|
| `commands/inspector.ts` 255 LOC split (server/registry/dispatch) | Marginal — file is coherent as-is; splitting adds friction without strong leverage |
| `commands/inspector-ui.ts` 299 LOC of HTML/CSS/JS | Single template string; would only benefit from extraction if growing |
| `zod-to-json-schema.ts` cast count (16 `as`) | Most are necessary structural reads on `Record<string, unknown>`; load-bearing for v3/v4 dual-shape support |
| `decorators.ts` `Reflect.getMetadata` casts (8+) | Standard reflect-metadata API surface; not actionable without changing the metadata signature |
| Full `mountHttpTransport` integration test (real HTTP roundtrip) | Heavier scaffolding than the value; covered indirectly in playground/manual smoke |
| `@internal` accessors on `McpServer` → public, typed read-only fields | Public API expansion, separate design pass |

---

## Wrap-up

After all three PRs land:

```bash
pnpm --filter @rudderjs/mcp typecheck
pnpm --filter @rudderjs/mcp test
pnpm --filter @rudderjs/mcp build
git log --oneline main..HEAD -- packages/mcp/ | head -20
```

**Expected line counts:**
- `packages/mcp/src/runtime.ts`: 488 → ~20 (barrel)
- New siblings: `src/runtime/sdk-server.ts`, `src/runtime/http-transport.ts`, `src/runtime/handle-deps.ts`, `src/runtime/consume-tool-return.ts`, `src/runtime/observers-accessor.ts`, `src/uri-template.ts`
- New tests: `src/commands/inspector.test.ts`; extensions to `src/index.test.ts` for SDK-handler + oauth2 happy paths.

**Public API check** (run on each PR before merge):
```bash
git diff main -- packages/mcp/src/index.ts | grep '^-export' | head
```
Every `-export` from `index.ts` should reappear via the new barrel paths. Net zero public surface change.

**Risk notes:**
- A4 (inspector streaming-tool fix) is the only user-visible behavior change. Patch-bump only.
- B (runtime split) is mechanical — review for accidental visibility changes when functions cross file boundaries.
- C1 (`_tools()` accessors) is the only change that touches `McpServer`'s public surface, even if `@internal`. If we ever want to make these properly public, do it in a separate minor bump.

---

## Sequencing

Recommended order: **A → B → C**.

- A is independent of B and C. Ships first for the inspector bug fix.
- B depends on A only for the `uri-template.ts` extraction (so `runtime.ts` doesn't keep its own copy after the split). If A merges first, B is clean.
- C depends on B (call sites it touches live in the new sibling files post-B1).

If A and B end up running in parallel branches, rebase C onto whichever lands last.

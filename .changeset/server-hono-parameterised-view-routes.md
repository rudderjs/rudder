---
'@rudderjs/server-hono': patch
---

fix(server-hono): SPA navigation to parameterised controller views no longer degrades to full reloads

Pipeline-hardening Phase 1 from the 2026-05-21 code-quality sweep (`docs/plans/2026-05-21-framework-pipeline-hardening.md`).

A controller route like `Route.get('/users/:id', ...)` that returns `view(...)` used to silently fall back to a full reload whenever a user clicked through to it from another view in the SPA. Vike's client router would emit a `/users/42/index.pageContext.json` request, and the outer fetch handler's gate for "is this a controller-view URL?" was an O(1) Set lookup that only tracked **static** paths — parameterised routes were excluded by design (the previous comment admitted: "only exact-match paths are tracked — parameterized routes (`/users/:id`) are not supported as controller views in v1"). The Set missed, the rewrite never fired, Vike's middleware saw an unrecognised pageContext URL, and the browser fell back to a full reload with no diagnostic.

**What changes**

`HonoAdapter` now maintains a second index alongside `controllerViewPaths`:

```ts
readonly controllerViewPatterns: Array<{ regex: RegExp; path: string }> = []
```

Routes whose path contains `:` are compiled to a regex once at `registerRoute()` time and appended. The new internal `_matchesControllerView(path)` walks the static Set first (O(1) hot path) and falls back to the regex array (O(n) over the dynamic-route count, which is tiny per app). The Vike SPA-nav rewrite branch now calls `_matchesControllerView` instead of `Set.has(...)`.

Wildcard-only routes (`*` with no `:`) stay excluded from both indexes — they're catch-all fallbacks, not view returns, and the pre-fix Set lookup never matched them against dynamic URLs either. Preserving that opt-out shape.

**Path compiler**

The compiler handles every shape `RouteBuilder` produces:

| Pattern | Regex (conceptually) | Matches |
|---|---|---|
| `/users/:id` | `^/users/[^/]+$` | `/users/42`, `/users/john-doe` |
| `/users/:id?` | `^/users(?:/[^/]+)?$` | `/users`, `/users/42` (slash folded into optional group) |
| `/users/:id{[0-9]+}` | `^/users/[0-9]+$` | `/users/42` only — letters rejected |
| `/users/:id{[0-9a-fA-F]{8}-...{12}}` | passes the custom regex through verbatim | full UUID pattern |
| `/posts/:slug/comments/:cid` | nested params, each one segment | `/posts/hello/comments/42` |
| `/posts/v1.0` | metachars escaped | `/posts/v1.0` only — `.` is literal, not any-char |

`RouteBuilder.where()` ships its own balanced-brace consumer for the `:param{regex}` syntax; this file ships a private local copy (`consumeBraceBlockLocal`) under the same contract so the two paths produce equivalent regex segments without a circular import on `@rudderjs/router`.

**API**

`compileControllerViewRegex(path: string): RegExp` is exported for the unit tests; not advertised as a public surface (`HonoAdapter` fields aren't either). No breaking changes — the existing `controllerViewPaths` Set remains as the static fast path.

**Tests**

16 new specs in `packages/server-hono/src/index.test.ts` across two describe blocks:

- `compileControllerViewRegex()` — 7 specs covering static paths, single `:param`, multiple/nested params, optional `:param?` after a slash, `:param{custom-regex}` (UUID + number constraints), regex-metachar escaping, root path.
- `HonoAdapter — controllerViewPatterns` — 9 specs covering Set vs Patterns index correctness, wildcard-only opt-out, non-GET filtering, `_matchesControllerView` lookup, plus three end-to-end fetch-handler regressions: parameterised SPA-nav rewrites land in the controller, static SPA-nav still works, and an unregistered `.pageContext.json` path is **not** rewritten into the controller.

76 → 92 specs in the server-hono test suite. Full-repo typecheck across 93 packages clean. Downstream packages tested clean (`router`, `core`, `auth`, `passport`, `mcp`, `middleware`).

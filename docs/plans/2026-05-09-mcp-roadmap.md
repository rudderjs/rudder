# @rudderjs/mcp — Roadmap

**Status:** roadmap only — per-feature plans get written when each item is picked up.
**Date:** 2026-05-09
**Scope:** Parity gaps with [Laravel MCP 13.x](https://laravel.com/docs/13.x/mcp) plus MCP-spec features both packages currently lack.

> **Companion doc:** `2026-05-09-ai-roadmap.md` covers `@rudderjs/ai`. This doc is the MCP track.

---

## Recommended sequence

| # | Item | Scope | Why this slot |
|---|---|---|---|
| M1 | Tool annotations (`IsReadOnly` / `IsDestructive` / `IsIdempotent` / `IsOpenWorld`) | XS (~1 d) | MCP protocol compliance. Clients (Claude Desktop, Cursor) use these for safe-tool detection. |
| M2 | Resource annotations (`Audience`, `Priority`, `LastModified`) | XS (~1 d) | Protocol compliance. Trivial decorator additions. |
| M3 | `shouldRegister(request)` conditional registration | XS (~½ d) | Multi-tenant servers need it. Tiny addition. |
| M4 | `oauthRoutes()` sugar + `Response.fromStorage()` helper | S (~2 d) | Polish around features we already have. |
| M5 | `Response.view()` template helper | S (~2 d) | Renders a template into an MCP response. Pairs with M6. |
| M6 | App resources (UI in MCP) | L (~2 wk) | Genuinely novel feature. Real differentiator if MCP UI takes off. |
| M7 | MCP-spec features both packages lack: elicitations, sampling, completions, roots | M+ (~1 wk each, lazy) | Track until clients actually consume them. Don't build speculatively. |

**Dependencies:**
- M5 (`Response.view`) blocks M6 (App resources) — view rendering is the foundation for the UI feature.
- M1–M4 are all independent and can ship in any order or together.

**Suggested order:** M1+M2+M3 as a single "MCP protocol compliance" PR → M4 → M5 → M6. M7 deferred until there's client demand.

---

## M1. Tool annotations

**Problem.** MCP protocol defines four behavior hints on tools that clients use to decide whether to auto-approve, batch, or sandbox a tool call. We don't surface them. Without these, every tool is treated as full-blast-radius.

The four annotations:

- `readOnlyHint` — tool does not modify state.
- `destructiveHint` — tool can perform destructive updates.
- `idempotentHint` — repeated calls with same input have no additional effect.
- `openWorldHint` — tool interacts with external systems (network, filesystem outside the server).

**Design.** New decorators on tool classes:

```ts
import { IsReadOnly, IsDestructive, IsIdempotent, IsOpenWorld } from '@rudderjs/mcp'

@IsReadOnly()
class GetUserTool extends McpTool {
  // ...
}

@IsDestructive()
@IsOpenWorld()
class DeleteFileTool extends McpTool { ... }
```

The runtime emits these as `annotations` fields on `tools/list` per the MCP spec.

**Effort:** ~1 day. 4 decorators + runtime emit + tests.

---

## M2. Resource annotations

**Problem.** Same shape as M1, applied to resources:

- `audience` — `'user' | 'assistant' | 'both'`. Hints whether a resource is meant for the user (UI surfaces it) or the assistant (LLM uses it).
- `priority` — `0..1`. Importance score for ranking when multiple resources match.
- `lastModified` — ISO 8601 timestamp. Lets clients cache + invalidate.

**Design.**

```ts
import { Audience, Priority, LastModified, MimeType } from '@rudderjs/mcp'

@Audience('user')
@Priority(0.9)
@MimeType('text/markdown')
class ReleaseNotesResource extends McpResource {
  uri() { return 'file://release-notes/latest.md' }
  async handle() {
    return McpResponse.text(await readReleaseNotes())
  }
  lastModified() { return new Date(/* ... */) }
}
```

`MimeType` already exists in some form — check `decorators.ts` and consolidate.

**Effort:** ~1 day. 3 decorators + runtime emit + tests.

---

## M3. `shouldRegister(request)` conditional registration

**Problem.** Multi-tenant MCP servers want to expose different tools/resources based on the auth context. Today every tool is always listed. Only workaround is splitting into separate servers.

**Design.**

```ts
class AdminOnlyTool extends McpTool {
  shouldRegister(request: McpRequest): boolean {
    return request.user()?.hasRole('admin') ?? false
  }
  // ...
}
```

Runtime: in `tools/list`, filter classes whose `shouldRegister` returns false. In `tools/call`, throw `MethodNotFound` if `shouldRegister` returns false for the calling request — prevents bypass.

**Pitfalls:**
- `shouldRegister` is called with the actual request, not at server start. Ensure auth middleware has run before tool resolution.
- Caching: don't cache `tools/list` results across requests if any tool has a `shouldRegister`.

**Effort:** ~½ day. Runtime filter + tests.

---

## M4. `oauthRoutes()` sugar + `Response.fromStorage()` helper

**Problem.** Two minor DX papercuts.

(1) Today wiring OAuth requires `oauth2McpMiddleware` + manual route mounting. Laravel's `Mcp::oauthRoutes()` mounts discovery + dynamic-client-registration in one line.

(2) `McpResponse` doesn't have a `fromStorage(disk, path)` helper. Apps have to read the file themselves and pass bytes.

**Design.**

```ts
// (1) OAuth
import { Mcp } from '@rudderjs/mcp'

Mcp.oauthRoutes()                  // mounts discovery + DCR

// (2) Storage
class ManualResource extends McpResource {
  async handle() {
    return McpResponse.fromStorage('docs', 'manual.pdf')   // disk + path
    //   ↑ reads via @rudderjs/storage, infers MIME from extension
  }
}
```

Both lazy-load their dependencies (`@rudderjs/storage`, OAuth handler).

**Effort:** ~2 days combined. Both are wrappers around existing primitives.

---

## M5. `Response.view()` template helper

**Problem.** MCP responses can carry HTML (for UI clients) or rich content. Today building HTML responses requires manual string assembly. Laravel's `Response::view('mcp.template', $data)` renders a Blade template — a clean abstraction.

**Design.** JS analog using a pluggable template engine:

```ts
import { McpResponse } from '@rudderjs/mcp'

// Vanilla — uses @rudderjs/view's html`` tagged template
McpResponse.html(html`<h1>Hello, ${name}</h1>`)

// React component (when @rudderjs/view is installed)
McpResponse.view(<DocumentList docs={docs} />)        // renders to HTML string
```

Implementation: thin wrapper that converts to `text/html` content with the right MIME type.

**Why this matters:** M6 (App resources) needs this as a foundation. Ship M5 first, then M6 builds on it.

**Effort:** ~2 days.

---

## M6. App resources (UI in MCP)

**Problem.** Laravel ships a feature called *MCP Apps* — a way to render an interactive HTML/JS UI inside an MCP response that calls server tools. The Blade component `<x-mcp::app>` + JS SDK (`createMcpApp`, `app.callServerTool`) wraps the whole thing in a sandboxed iframe spec with CSP, permissions (camera, microphone, geolocation, clipboard), and library hints (Tailwind, Alpine).

This is genuinely novel. If MCP UI becomes a thing (Claude Desktop, Cursor, ChatGPT all hint at this direction), having it ready is a real differentiator.

**Design sketch:**

```ts
// Server side — app resource
import { McpAppResource, AppMeta, Visibility } from '@rudderjs/mcp'

@AppMeta({
  permissions:    ['geolocation', 'camera'],
  connectDomains: ['api.example.com'],
  libraries:      ['tailwind'],
})
class WeatherApp extends McpAppResource {
  uri() { return 'app://weather' }

  async handle() {
    return McpResponse.app(<WeatherWidget />)        // React component
  }
}

// Tool visibility (only callable from the UI, not the LLM)
@RendersApp(WeatherApp, Visibility.App)
class GetCurrentLocationTool extends McpTool { ... }

// Client-side JS (inside the rendered app)
import { createMcpApp } from '@rudderjs/mcp/app-sdk'

createMcpApp(async (app) => {
  const loc = await app.callServerTool('get_current_location', {})
  app.render(<WeatherDetails loc={loc} />)
  app.openLink('https://weather.com/...')
})
```

**Implementation outline:**
- New base class `McpAppResource` with `@AppMeta`, `@Visibility` decorators.
- Runtime serves the app HTML wrapped in an MCP-spec iframe envelope with the configured CSP + permissions.
- New subpath export `@rudderjs/mcp/app-sdk` for the client-side helper. Runtime-agnostic (browser/Electron/RN-WebView).
- `Visibility.App` tools are filtered out of `tools/list` to the LLM but exposed to the app via a separate listing.
- Reference implementation in playground/Mcp/.

**Pitfalls:**
- CSP correctness — get this wrong and the app silently breaks.
- Permission model — clipboard write, camera, mic, geolocation. Default deny; explicit opt-in.
- Sandbox escape — apps must not be able to call cross-origin or access the parent window. Test thoroughly.
- React/Vue/Solid — pick **React only** for v1 per the React-only-default-for-packages rule. Vue/Solid later if asked.

**Effort:** ~2 weeks. Big feature — base class + runtime envelope + client SDK + permission system + CSP wiring + reference impl + docs.

**Open question:** does this even belong in `@rudderjs/mcp` or a separate `@rudderjs/mcp-apps`? Lean toward separate package once the design crystallizes — it's a heavy feature with its own peer deps (a renderer, a CSP utility).

---

## M7. MCP-spec features both packages lack

These are MCP-spec items neither Laravel nor we currently implement. Track them; build only when there's real client demand.

**Elicitations.** Server asks the client to prompt the user for input mid-tool-call. E.g., a `book_flight` tool elicits "what's your seat preference?" as a structured form. Spec: `elicitation/create`. Use case: replaces brittle multi-turn tool sequences.

**Sampling.** Server asks the client to sample its LLM on the server's behalf. E.g., a `summarize_email` tool that delegates the actual summarization back to the calling client's model (saves the server's API costs and respects user's model choice). Spec: `sampling/createMessage`.

**Completions.** Argument autocomplete. Spec: `completion/complete`. Useful for resource URI templates with complex parameter values.

**Roots.** Filesystem boundary hints. Server tells the client "I can read these directories." Spec: `roots/list`.

**Status:** monitoring. Each is ~1 week of spec implementation + adapter work. Don't speculatively build — Claude Desktop, Cursor, and ChatGPT each consume different subsets, and the MCP spec itself is still evolving here.

---

## Items considered but rejected (for now)

- **MCP Inspector clone.** Laravel mentions an Inspector tool. We have `McpTestClient` for in-process testing; for live debugging, the official MCP Inspector CLI works. Don't reinvent.
- **PHP-style attribute syntax (`#[Description]`).** We use TS decorators where they help (already have `@Name`, `@Version`, `@Description`); not every annotation needs to become a decorator.
- **`vendor:publish --tag=mcp-views`.** Not how npm/scaffolders work. Auth views vendored via `@rudderjs/auth` already.

---

## Our advantages over Laravel MCP

- **`async function*` tool handlers** with progress yields surfaced as `notifications/progress`.
- **`McpTestClient`** — programmatic in-process test client. Laravel docs only mention the Inspector for testing.
- **Observer registry** for telemetry (`@rudderjs/mcp/observers`).
- **Lazy SDK loading** for the official `@modelcontextprotocol/sdk` peer.

---

## Open questions

1. **Should App resources (M6) be a separate package?** Heavy feature with distinct peer deps. Lean toward `@rudderjs/mcp-apps` once design crystallizes.
2. **Decorator-vs-method for protocol annotations.** M1/M2 lean toward decorators for parity with Laravel's `#[IsReadOnly]`. But our existing patterns mix decorators (`@Name`) and methods (`uri()`, `handle()`). Be consistent within each class.
3. **Spec-feature tracking (M7).** Worth a periodic audit each minor version of the MCP spec — pick the doc up-rev as new clients ship.

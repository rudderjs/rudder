# MCP HTTP/SSE Transport & Auth Plan

Add HTTP/SSE transport and authentication to `@rudderjs/mcp`, closing the two biggest gaps vs Laravel MCP. Also adds output schemas on tools, resource URI templates, DI in `handle()`, and an MCP inspector command.

**Status:** Not started

**Packages affected:** `@rudderjs/mcp`, `@rudderjs/boost` (consumer — verify still works)

**Breaking change risk:** None. All changes are additive. Existing `McpTool.handle(input)` signature stays valid — DI injection is opt-in via an overload. `@rudderjs/boost` uses `@rudderjs/mcp` internally; its `createBoostServer()` must keep working on stdio with zero changes.

**Depends on:** Nothing — independent of AI events plan and boost plan.

**Consumer impact:**
- `@rudderjs/boost` — uses `createSdkServer()` and `startStdio()`. Neither changes. Verify boost test suite passes after each phase.
- No external consumers of `@rudderjs/mcp` exist outside rudderjs monorepo.

---

## Goal

After this plan:

1. `Mcp.web('/mcp/weather', WeatherServer)` registers an HTTP/SSE endpoint that remote AI clients can connect to — the same DX as Laravel's `Mcp::web()`.
2. Web MCP servers support auth via `.middleware([...])` (framework middleware) and a dedicated `.oauth2()` helper for OAuth 2.1 flows.
3. Tools can declare `outputSchema()` for structured output validation.
4. Resources can use URI templates with `{param}` placeholders for dynamic data.
5. `handle()` methods can request DI-injected services as additional parameters.
6. `rudder mcp:inspector` launches a web debugger for testing MCP servers interactively.

---

## Non-Goals

- **WebSocket transport.** HTTP/SSE covers the MCP spec. WebSocket is a future concern.
- **Custom auth providers.** We support middleware (which can do anything) and OAuth 2.1. No SAML, LDAP, etc.
- **Client-side MCP SDK.** This plan is server-only. `@rudderjs/ai` already has provider-tools for MCP client consumption.
- **Blob responses.** Low priority — can be added later as a `McpResponse.blob()` static.
- **Request validation DSL.** Zod schemas already validate inputs. No need for a separate `$request.validate()` layer.

---

## Phase 1 — HTTP/SSE Transport

**What:** Wire up `Mcp.web()` registrations to actual HTTP endpoints served by the framework's server adapter (Hono).

**Files to create/modify:**

1. **`packages/mcp/src/transports/sse.ts`** (new) — SSE transport adapter using `@modelcontextprotocol/sdk`'s `SSEServerTransport`. Handles:
   - `GET /path` — SSE connection endpoint (event stream)
   - `POST /path` — message endpoint (client → server JSON-RPC)
   - Session management (connect/disconnect lifecycle)

2. **`packages/mcp/src/transports/streamable-http.ts`** (new) — Streamable HTTP transport per MCP spec (the newer transport that replaces SSE). This is the primary transport:
   - `POST /path` — handles both initialization and ongoing messages
   - `GET /path` — optional SSE stream for server-initiated notifications
   - `DELETE /path` — session termination
   - Session ID via `Mcp-Session-Id` header

3. **`packages/mcp/src/runtime.ts`** (modify) — Add `startHttp(server, honoApp, path, options?)` alongside existing `startStdio()`. This:
   - Creates the SDK server via existing `createSdkServer()`
   - Mounts the streamable HTTP routes on the Hono app
   - Falls back to SSE transport if client doesn't support streamable HTTP

4. **`packages/mcp/src/provider.ts`** (modify) — During `boot()`, iterate `Mcp.getWebServers()` and mount each on the framework's Hono instance via `startHttp()`.

5. **`packages/mcp/src/Mcp.ts`** (modify) — `web()` already stores entries in a Map. Add middleware storage:
   ```ts
   static web(path: string, server: typeof McpServer, middleware?: any[]) {
     // store { serverClass, middleware }
     return { middleware: (mw: any[]) => ... } // fluent chain
   }
   ```

**Test:** Start playground, `curl -X POST http://localhost:3000/mcp/test` with a JSON-RPC `initialize` message, verify handshake completes.

---

## Phase 2 — Authentication

**What:** Middleware-based auth on web MCP endpoints + OAuth 2.1 helper.

**Files to create/modify:**

1. **`packages/mcp/src/Mcp.ts`** (modify) — The fluent return from `Mcp.web()` gains:
   ```ts
   .middleware([AuthMiddleware, RateLimitMiddleware])
   .oauth2(options?)  // shorthand that pushes OAuth2McpMiddleware
   ```

2. **`packages/mcp/src/auth/oauth2.ts`** (new) — OAuth 2.1 middleware for MCP:
   - Implements the MCP OAuth 2.1 spec (RFC 9728 discovery, PKCE, token exchange)
   - Uses `@rudderjs/auth` if installed (optional peer) for user resolution
   - Standalone token validation if no auth package

3. **`packages/mcp/src/runtime.ts`** (modify) — `startHttp()` applies the middleware stack from `Mcp.getWebServers()` before the transport handlers.

**Auth flow:**
- Middleware runs before every MCP request (GET/POST)
- Framework middleware (`@rudderjs/middleware`) works out of the box since we're on Hono
- `oauth2()` is a convenience that pushes a pre-built middleware

**Test:** Register a web server with `Mcp.web('/mcp/secure', SecureServer).middleware([mockAuth])`, verify unauthenticated requests get 401.

---

## Phase 3 — Output Schemas, Resource Templates, DI

**What:** Three smaller enhancements that bring parity with Laravel MCP.

### 3a — Output Schemas on Tools

**`packages/mcp/src/McpTool.ts`** (modify):
```ts
abstract class McpTool {
  // existing
  abstract schema(): z.ZodObject<any>
  abstract handle(input: any): Promise<McpToolResult>

  // new — optional
  outputSchema?(): z.ZodObject<any>
}
```

**`packages/mcp/src/runtime.ts`** (modify) — In `ListTools` handler, if tool has `outputSchema()`, convert via `zodToJsonSchema()` and include in the tool definition.

### 3b — Resource URI Templates

**`packages/mcp/src/McpResource.ts`** (modify):
```ts
abstract class McpResource {
  abstract uri(): string  // can now contain {param} placeholders

  // new — if uri() contains {params}, this is a template resource
  isTemplate(): boolean {
    return this.uri().includes('{')
  }
}
```

**`packages/mcp/src/runtime.ts`** (modify):
- Template resources register via `ListResourceTemplates` handler instead of `ListResources`
- `ReadResource` matches incoming URIs against templates, extracts params, passes to `handle()`

### 3c — DI in handle()

**`packages/mcp/src/runtime.ts`** (modify) — Before calling `tool.handle(input)`:
1. Inspect `handle` method parameter types via reflect-metadata
2. Resolve additional parameters from the DI container (`app().make()`)
3. Call `handle(input, ...resolvedDeps)`

This is backward-compatible: existing `handle(input)` still works — extra DI params are only injected if the method signature declares them.

**Test:** Create a tool whose `handle(input, logger: Logger)` receives a DI-injected logger.

---

## Phase 4 — MCP Inspector

**What:** `rudder mcp:inspector` command that launches a web UI for testing MCP servers.

**Files to create:**

1. **`packages/mcp/src/commands/inspector.ts`** (new) — CLI command that:
   - Lists all registered servers (web + local)
   - Spins up a lightweight HTTP server (e.g., port 9100)
   - Serves a single-page inspector UI
   - Connects to the selected MCP server
   - Lets you: list tools/resources/prompts, call tools with JSON input, view responses

2. **`packages/mcp/src/inspector/`** (new directory) — Minimal HTML/JS inspector UI. Can start very simple (form-based, no React) and iterate.

**Test:** `rudder mcp:inspector`, open browser, call a tool, see response.

---

## Phase Order & Estimates

| Phase | Description | Depends on |
|---|---|---|
| 1 | HTTP/SSE transport | — |
| 2 | Authentication | Phase 1 |
| 3a | Output schemas | — (parallel with 1-2) |
| 3b | Resource templates | — (parallel with 1-2) |
| 3c | DI in handle() | — (parallel with 1-2) |
| 4 | MCP Inspector | Phase 1 (needs web transport) |

Phases 3a/3b/3c can be done in parallel with 1-2 since they're independent stdio-compatible features.

---

## Verification Checklist

- [ ] `@rudderjs/boost` test suite passes (no regression)
- [ ] Stdio transport still works (`rudder mcp:start <name>`)
- [ ] Web transport serves MCP over HTTP (`Mcp.web()`)
- [ ] Middleware blocks unauthenticated requests
- [ ] OAuth 2.1 flow completes end-to-end
- [ ] Output schemas appear in tool listings
- [ ] Resource templates resolve URI params
- [ ] DI injects services into handle()
- [ ] Inspector UI can call tools and display responses
- [ ] All existing MCP tests pass
- [ ] `pnpm typecheck` clean across monorepo

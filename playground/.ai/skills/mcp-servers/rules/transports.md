# Transports — stdio vs HTTP/SSE

## When to pick which

| | stdio | HTTP/SSE |
|---|---|---|
| Registration | `Mcp.local('name', Server)` | `Mcp.web('/path', Server)` |
| Discovery | Run via `pnpm rudder mcp:start <name>` | Mounted at the configured path |
| Caller | A CLI / desktop AI assistant that spawns the server as a subprocess | A web AI assistant or remote agent |
| Auth | Stays inside the subprocess boundary | Per-request (use middleware) |
| Lifecycle | One process per session | Sessions multiplexed by the runtime |

Most apps register both — local for IDE integration, web for external agents.

## stdio (local CLI)

```ts
// routes/console.ts or a provider's boot()
import { Mcp } from '@rudderjs/mcp'
import { AppMcpServer } from '../app/Mcp/AppMcpServer.js'

Mcp.local('app', AppMcpServer)
```

Run with:

```bash
pnpm rudder mcp:start app
```

Clients (Claude Code, Cursor, etc.) point at the same command via their MCP config files.

## HTTP/SSE (web)

```ts
import { Mcp } from '@rudderjs/mcp'
import { AppMcpServer } from '../app/Mcp/AppMcpServer.js'

Mcp.web('/mcp', AppMcpServer)
```

This mounts three endpoints automatically:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC messages |
| `GET`  | `/mcp` | SSE stream for server-initiated notifications |
| `DELETE` | `/mcp` | Session termination |

## Web auth via middleware

Mount per-request middleware on the web transport:

```ts
import { RequireBearer, scope } from '@rudderjs/passport'

Mcp.web('/mcp', AppMcpServer).middleware([
  RequireBearer(),
  scope('mcp:invoke'),
])
```

Middleware runs once per `POST /mcp` request — the same lifecycle as a normal route.

## Pitfalls

❌ **Don't** put `Mcp.web()` in a code path that runs in stdio mode and vice versa:

```ts
Mcp.local('app', AppMcpServer)   // ✓ stdio
Mcp.web('/mcp', AppMcpServer)    // ✓ HTTP — both can coexist
```

If you really need one or the other to be conditional, gate on `process.env`.

❌ **Don't** apply web middleware to a stdio server — stdio has no HTTP request:

```ts
Mcp.local('app', AppMcpServer).middleware([RequireBearer()])   // ignored on stdio
```

✅ **Do** add auth inside the tool's `handle()` if you need it on stdio:

```ts
async handle(input) {
  const apiKey = process.env.MCP_API_KEY
  if (input.key !== apiKey) return McpResponse.error('Unauthorized')
  // …
}
```

❌ **Don't** mount the HTTP transport without `@rudderjs/router`:

The web transport dynamically imports `@rudderjs/router` to register endpoints. Stdio has no such dep.

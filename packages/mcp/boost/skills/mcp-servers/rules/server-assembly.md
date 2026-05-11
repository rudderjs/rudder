# Assembling and Registering a Server

## Server class

```ts
// app/Mcp/AppMcpServer.ts
import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'
import { WeatherTool }      from './Tools/WeatherTool.js'
import { SchemaResource }   from './Resources/SchemaResource.js'
import { TableResource }    from './Resources/TableResource.js'
import { ReviewPrompt }     from './Prompts/ReviewPrompt.js'

@Name('my-app-mcp')
@Version('1.0.0')
@Instructions('An MCP server for my application. Use the weather tool to check conditions.')
export class AppMcpServer extends McpServer {
  protected tools     = [WeatherTool]
  protected resources = [SchemaResource, TableResource]
  protected prompts   = [ReviewPrompt]
}
```

`@Name`, `@Version`, `@Instructions` set server metadata via reflect-metadata. `@Description` works on individual tools / resources / prompts.

## Register the MCP service provider

```ts
// bootstrap/providers.ts
import { defaultProviders } from '@rudderjs/core'
import { mcp } from '@rudderjs/mcp'

export default [
  ...(await defaultProviders()),
  mcp(),   // registers the Mcp facade + boots web/local servers + CLI commands
]
```

## Register a server (transport choice in `routes/console.ts` or a provider's `boot()`)

```ts
import { Mcp } from '@rudderjs/mcp'
import { AppMcpServer } from '../app/Mcp/AppMcpServer.js'

// stdio (local CLI) — run via `pnpm rudder mcp:start app`
Mcp.local('app', AppMcpServer)

// HTTP/SSE (web)
Mcp.web('/mcp', AppMcpServer)
```

See `rules/transports.md` for the differences.

## CLI commands

| Command | Purpose |
|---|---|
| `pnpm rudder mcp:start <name>` | Start a registered local (stdio) server |
| `pnpm rudder mcp:list` | List all registered servers (web + local) |

## Pitfalls

❌ **Don't** instantiate tool classes in the array:

```ts
protected tools = [new WeatherTool()]   // bypasses DI; instance is shared across requests
```

✅ **Do** pass the class — the runtime instantiates per call (and resolves via the DI container when available):

```ts
protected tools = [WeatherTool]
```

❌ **Don't** mix transport registration with route registration:

```ts
Mcp.web('/mcp', AppMcpServer)   // ✅ registers MCP endpoint
Route.get('/mcp', handler)      // ❌ collides on the same path
```

✅ **Do** keep MCP paths and regular HTTP paths distinct.

❌ **Don't** add `mcp()` to providers if you don't actually use it — it boots an extra dispatcher loop you'd rather not have at idle.

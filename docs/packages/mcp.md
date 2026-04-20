# @rudderjs/mcp

MCP (Model Context Protocol) server framework. Lets your app **expose tools, resources, and prompts** to external AI agents — Claude Code, Cursor, Windsurf, any MCP-compatible client. Also ships an HTTP Streamable transport with OAuth 2.1 protection, a local stdio transport, DI integration, and a test client.

For the narrative guide see [MCP](/guide/mcp). This page is the API reference.

## Installation

```bash
pnpm add @rudderjs/mcp
```

Auto-discovered via `defaultProviders()`. Or register manually:

```ts
import { McpProvider } from '@rudderjs/mcp'
export default [..., McpProvider]
```

No config file — servers are registered via code (`Mcp.web()` / `Mcp.local()`).

## Servers, tools, resources, prompts

Register **classes**, not instances — the runtime instantiates via DI.

### Server

```ts
import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'

@Name('Weather Server')
@Version('1.0.0')
@Instructions('Provide weather information and forecasts.')
export class WeatherServer extends McpServer {
  protected tools     = [CurrentWeatherTool]
  protected resources = [WeatherGuidelines, CityWeatherResource]
  protected prompts   = [DescribeWeatherPrompt]
}
```

### Tool

```ts
import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Get current weather for a location.')
export class CurrentWeatherTool extends McpTool {
  schema() {
    return z.object({
      location: z.string().describe('City name'),
    })
  }

  async handle(input: Record<string, unknown>) {
    return McpResponse.text(`Weather in ${input.location}: sunny, 22°C`)
  }
}
```

**Output schema** — optional, advertises the response shape:

```ts
outputSchema() {
  return z.object({ temperature: z.number(), conditions: z.string() })
}
async handle() {
  return McpResponse.json({ temperature: 22, conditions: 'sunny' })
}
```

### Resource

Two flavours — **static URIs** and **URI templates**:

```ts
@Description('Weather usage guidelines')
export class WeatherGuidelines extends McpResource {
  uri() { return 'weather://guidelines' }
  async handle() { return 'Always check conditions before...' }
}

@Description('Weather for a specific city')
export class CityWeatherResource extends McpResource {
  uri() { return 'weather://city/{name}' }
  async handle(params?: Record<string, string>) {
    return `Weather in ${params?.name}: sunny, 22°C`
  }
}
```

Template resources auto-register via `ListResourceTemplates`. Params are extracted from the URI and passed to `handle()` as a `Record<string, string>`.

### Prompt

```ts
@Description('Describe weather poetically')
export class DescribeWeatherPrompt extends McpPrompt {
  arguments() { return z.object({ location: z.string() }) }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    return [{ role: 'user', content: `Describe weather in ${args.location} poetically.` }]
  }
}
```

### Response helpers

```ts
McpResponse.text('Plain text output')
McpResponse.json({ key: 'value' })
McpResponse.error('Something went wrong')
```

## Registering servers

Two transports: **HTTP Streamable** (remote clients) and **stdio** (local CLIs).

```ts
import { Mcp } from '@rudderjs/mcp'

// HTTP — served at /mcp/weather
Mcp.web('/mcp/weather', WeatherServer)

// With middleware
Mcp.web('/mcp/weather', WeatherServer).middleware([rateLimitMw])

// OAuth 2.1 protection (requires @rudderjs/passport)
Mcp.web('/mcp/admin', AdminServer).oauth2({
  scopes:              ['admin'],
  authorizationServers: ['https://auth.example.com'],
  scopesSupported:      ['admin', 'read', 'write'],
})

// Local stdio — runnable as a CLI
Mcp.local('weather', WeatherServer)
```

Call these in a provider's `boot()` or a registration module loaded from `routes/` — **not** inside request handlers. They register once at boot.

`.oauth2()` validates the Bearer JWT via `@rudderjs/passport`, enforces required scopes, and registers an RFC 9728 **Protected Resource Metadata** endpoint at `/.well-known/oauth-protected-resource<mcp-path>`. On auth failure, responses carry a `WWW-Authenticate` header pointing the client at the metadata doc.

## Dependency injection

Constructor params auto-resolve from the DI container:

```ts
@Injectable()
@Description('Query the database')
export class DbQueryTool extends McpTool {
  constructor(private db: DatabaseService) { super() }

  schema() { return z.object({ query: z.string() }) }

  async handle(input: Record<string, unknown>) {
    const result = await this.db.query(input.query as string)
    return McpResponse.json(result)
  }
}
```

### Method-level DI under Vite

esbuild drops `design:paramtypes` metadata, so reflection-based auto-inject silently no-ops. Use `@Handle(...)` with explicit tokens:

```ts
@Handle(GreetingService, Logger)
async handle(input: Record<string, unknown>, greeter: GreetingService, logger: Logger) {
  logger.info(greeter.say(input.name as string))
  return McpResponse.text('ok')
}
```

## CLI commands

```bash
pnpm rudder mcp:list                  # list registered servers
pnpm rudder mcp:start <name>          # run a local server over stdio
pnpm rudder mcp:inspector <name>      # launch the MCP Inspector UI
pnpm rudder make:mcp-server Weather
pnpm rudder make:mcp-tool CurrentWeather
pnpm rudder make:mcp-resource WeatherGuidelines
pnpm rudder make:mcp-prompt DescribeWeather
```

Scaffolders land in `app/Mcp/{Servers,Tools,Resources,Prompts}/`.

## Testing

`McpTestClient` boots the server in-process — no network, no stdio spawn:

```ts
import { McpTestClient } from '@rudderjs/mcp'

const client = new McpTestClient(WeatherServer)

const result = await client.callTool('current-weather', { location: 'London' })

client.assertToolExists('current-weather')
client.assertToolCount(1)
client.assertResourceExists('weather://guidelines')
client.assertPromptExists('describe-weather')

const tools     = await client.listTools()
const resources = await client.listResources()
const prompts   = await client.listPrompts()
```

## Observer registry

Every tool call, resource read, and prompt render emits a structured event. `@rudderjs/telescope` subscribes automatically — events land under the **MCP** tab with full input/output, timing, server name, errors.

For custom logging:

```ts
import { mcpObservers } from '@rudderjs/mcp/observers'

mcpObservers.subscribe((event) => {
  // event.kind: 'tool.called' | 'tool.failed' | 'resource.read'
  //           | 'resource.failed' | 'prompt.rendered' | 'prompt.failed'
  console.log(`[${event.kind}] ${event.serverName}/${event.name} (${event.duration}ms)`)
})
```

The registry lives on `globalThis` so it survives Vite SSR re-evaluation. Observer errors are swallowed inside `emit()` — a broken subscriber cannot break an MCP server. Don't import `/observers` in normal app code; it's for collector packages.

## Exports

```ts
// Building blocks
import { McpServer, McpTool, McpResource, McpPrompt, McpResponse } from '@rudderjs/mcp'

// Decorators
import { Name, Version, Instructions, Description, Handle } from '@rudderjs/mcp'

// Registration facade
import { Mcp } from '@rudderjs/mcp'

// OAuth 2.1
import { oauth2McpMiddleware, registerOAuth2Metadata } from '@rudderjs/mcp'

// Runtime primitives (rarely needed in app code)
import { createSdkServer, startStdio, mountHttpTransport } from '@rudderjs/mcp'

// Provider + testing
import { McpProvider, McpTestClient } from '@rudderjs/mcp'

// Observer registry — for collectors, not app code
import { mcpObservers } from '@rudderjs/mcp/observers'

// Types
import type {
  McpServerMetadata, McpToolResult, McpPromptMessage,
  McpWebEntry, McpWebBuilder, HttpTransportOptions,
  OAuth2McpOptions, InjectToken,
  McpObserverEvent, McpObserver, McpObserverRegistry,
} from '@rudderjs/mcp'
```

---

## Common pitfalls

- **Register classes, not instances.** `protected tools = [MyTool]` — never `[new MyTool()]`. The runtime instantiates via DI.
- **`Mcp.web()` / `Mcp.local()` only run at boot.** Put them in a provider's `boot()` or a registration module loaded from `routes/`, not inside request handlers.
- **`.oauth2()` needs Passport.** Without `@rudderjs/passport` installed and configured, every request fails `invalid_token`.
- **Constructor DI works; method DI under Vite needs `@Handle(...)`.** esbuild drops `design:paramtypes`, so `@Handle()` without tokens silently falls back to empty. Always pass explicit tokens.
- **URI templates only support `{param}`.** No regex, no optional segments. Extracted params are always strings — validate/coerce inside `handle()`.
- **Output schema must match `handle()` return.** Declaring `outputSchema()` but returning a mismatched shape surfaces a validation error to the client.
- **`McpResponse.error()` vs throwing.** `McpResponse.error(msg)` returns an MCP-shaped error for expected failures. Throw for programmer errors — throws emit `tool.failed` observer events and surface a generic error to the client.
- **Don't import `/observers` in app code.** That subpath is for Telescope-style collectors. App-level tool-call logging belongs in AI middleware or route observability.
- **Provider boot order.** `McpProvider` registers HTTP routes with the router, so the router provider must boot first. Auto-discovery handles this — don't move `McpProvider` earlier in a custom provider list.

---

## Related

- [MCP guide](/guide/mcp) — tutorial-style walkthrough
- [`@rudderjs/ai`](./ai/) — the client side: run agents that call tools
- [`@rudderjs/passport`](./passport) — OAuth 2.1 token issuer for `.oauth2()` protection
- [`@rudderjs/telescope`](./telescope) — MCP observability dashboard

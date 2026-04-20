# @rudderjs/mcp

## Overview

MCP (Model Context Protocol) server framework for RudderJS. Lets the app expose **tools**, **resources**, and **prompts** to AI agents (Claude Code, Cursor, etc.) over either HTTP Streamable transport or local stdio. Tools and resources are plain classes with decorator-driven metadata and Zod input schemas. DI resolves constructor dependencies, OAuth 2.1 protects HTTP endpoints via `@rudderjs/passport`, and an observer registry exposes every tool call / resource read / prompt render for Telescope and other collectors.

## Key Patterns

### Server Definition

Extend `McpServer` and list the tool/resource/prompt **classes** (not instances). Metadata comes from decorators on the class.

```ts
import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'

@Name('Weather Server')
@Version('1.0.0')
@Instructions('Provide weather information and forecasts.')
export class WeatherServer extends McpServer {
  protected tools     = [CurrentWeatherTool]
  protected resources = [WeatherGuidelinesResource, CityWeatherResource]
  protected prompts   = [DescribeWeatherPrompt]
}
```

### Tools

Declare input via Zod, return via `McpResponse` helpers. Decorator `@Description` drives what the AI sees.

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
    const location = input.location as string
    return McpResponse.text(`Weather in ${location}: sunny, 22°C`)
  }
}
```

**Output schemas** — optional, advertises structured response shape to the client:

```ts
outputSchema() {
  return z.object({ temperature: z.number(), conditions: z.string() })
}
// handle() must return JSON matching the schema
async handle() { return McpResponse.json({ temperature: 22, conditions: 'sunny' }) }
```

### Resources

Two shapes — **static URIs** and **URI templates**:

```ts
// Static URI
@Description('Weather usage guidelines')
export class WeatherGuidelinesResource extends McpResource {
  uri() { return 'weather://guidelines' }
  async handle() { return 'Always check conditions before...' }
}

// URI template — {param} placeholders
@Description('Weather for a specific city')
export class CityWeatherResource extends McpResource {
  uri() { return 'weather://city/{name}' }  // template
  async handle(params?: Record<string, string>) {
    return `Weather in ${params?.name}: sunny, 22°C`
  }
}
```

Templates are auto-registered via `ListResourceTemplates`. Params are extracted from the URI and passed to `handle()`.

### Prompts

Like tools, but return message arrays instead of content:

```ts
import { McpPrompt, Description } from '@rudderjs/mcp'

@Description('Describe weather poetically')
export class DescribeWeatherPrompt extends McpPrompt {
  arguments() { return z.object({ location: z.string() }) }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    return [{ role: 'user', content: `Describe weather in ${args.location} poetically.` }]
  }
}
```

### Response Helpers

```ts
McpResponse.text('Plain text output')
McpResponse.json({ key: 'value' })
McpResponse.error('Something went wrong')
```

### Dependency Injection

Constructor params are auto-resolved from the DI container when the class is instantiated by the runtime. Falls back to `new T()` if the container isn't available.

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

**Method-level DI** — use `@Handle(TokenA, TokenB, ...)` to request DI-resolved extra parameters beyond the first. This is required under Vite/esbuild because those toolchains drop `design:paramtypes` metadata; explicit tokens are the reliable path.

```ts
@Handle(GreetingService, Logger)
async handle(input: Record<string, unknown>, greeter: GreetingService, logger: Logger) {
  logger.info(greeter.say(input.name as string))
  return McpResponse.text('ok')
}
```

### Registering Servers

```ts
import { Mcp } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/Servers/WeatherServer.js'

// HTTP (Streamable HTTP transport) — served at the given path
Mcp.web('/mcp/weather', WeatherServer)

// With middleware chain
Mcp.web('/mcp/weather', WeatherServer).middleware([rateLimitMw, loggingMw])

// Protected by OAuth 2.1 Bearer tokens (requires @rudderjs/passport)
Mcp.web('/mcp/weather', WeatherServer).oauth2({ scopes: ['mcp:read'] })

// Local stdio (CLI)
Mcp.local('weather', WeatherServer)
```

Registration runs once at boot; it's not per-request. Put these calls in a provider's `boot()` method or a dedicated registration module loaded from there.

### OAuth 2.1 Protection

`.oauth2()` on the builder chain does three things: validates the Bearer JWT via `@rudderjs/passport`, enforces required scopes, and registers an RFC 9728 **Protected Resource Metadata** endpoint at `/.well-known/oauth-protected-resource<mcp-path>`. On auth failure, the response carries a `WWW-Authenticate` header pointing the client at that metadata doc — standard MCP client discovery flow.

```ts
Mcp.web('/mcp/admin', AdminServer).oauth2({
  scopes: ['admin'],                          // required on the token
  authorizationServers: ['https://auth.example.com'],  // defaults to app origin
  scopesSupported: ['admin', 'read', 'write'],         // advertised in metadata
})
```

Passport must be installed and configured — see `@rudderjs/passport` guidelines. Without it, the OAuth middleware returns `invalid_token` with the metadata URL.

### Observer Registry (Telescope Integration)

Every tool call, resource read, and prompt render emits a structured event. Packages like Telescope subscribe to collect telemetry; apps can subscribe too for custom logging.

```ts
import { mcpObservers } from '@rudderjs/mcp/observers'

const unsubscribe = mcpObservers.subscribe((event) => {
  // event.kind: 'tool.called' | 'tool.failed' | 'resource.read'
  //           | 'resource.failed' | 'prompt.rendered' | 'prompt.failed'
  console.log(`[${event.kind}] ${event.serverName}/${event.name} (${event.duration}ms)`)
})
```

The registry is a singleton stored on `globalThis` so state survives Vite SSR module re-evaluation. Observer errors are swallowed inside `emit()` — a broken subscriber cannot break an MCP server.

Don't import `@rudderjs/mcp/observers` in normal app code; it's meant for collector packages.

### Config Shape

```ts
// config/mcp.ts (optional — no required fields today)
export default {
  // currently no required configuration; provider reads servers from Mcp.web/Mcp.local
} satisfies Record<string, unknown>

// bootstrap/providers.ts — provider is auto-discovered after `rudder providers:discover`
import { McpProvider } from '@rudderjs/mcp'
export default [..., McpProvider]
```

### CLI Commands

```bash
pnpm rudder mcp:start <name>      # start a local server via stdio
pnpm rudder mcp:list              # list all registered MCP servers (web + local)
pnpm rudder mcp:inspector <name>  # launch the MCP Inspector UI
```

### Scaffolders

```bash
pnpm rudder make:mcp-server   Weather
pnpm rudder make:mcp-tool     CurrentWeather
pnpm rudder make:mcp-resource WeatherGuidelines
pnpm rudder make:mcp-prompt   DescribeWeather
```

Scaffolders land in `app/Mcp/{Servers,Tools,Resources,Prompts}/`.

### Testing

`McpTestClient` boots an in-process server and exposes a minimal protocol client — no network hop, no stdio spawn.

```ts
import { McpTestClient } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/Servers/WeatherServer.js'

const client = new McpTestClient(WeatherServer)

const result = await client.callTool('current-weather', { location: 'London' })

client.assertToolExists('current-weather')
client.assertToolCount(1)
client.assertResourceExists('weather://guidelines')
client.assertPromptExists('describe-weather')

const tools = await client.listTools()
const resources = await client.listResources()
const prompts = await client.listPrompts()
```

## Common Pitfalls

- **Register classes, not instances** — `protected tools = [MyTool]` (class), never `[new MyTool()]`. The runtime instantiates each class via DI when the server boots.
- **`Mcp.web()` / `Mcp.local()` only run once** — at boot. Put them in a provider's `boot()` or a route-loaded module; never in request handlers.
- **OAuth 2.1 needs Passport** — `.oauth2()` requires `@rudderjs/passport` installed and configured. Without it, every request fails `invalid_token`.
- **Constructor DI works, but method DI under Vite needs `@Handle(...)`** — esbuild drops `design:paramtypes` metadata, so `@Handle()` without tokens silently falls back to empty. Always pass explicit tokens.
- **Zod v4 introspection differences** — the JSON-schema converter in `zod-to-json-schema.ts` handles both v3 and v4 shapes (`.describe()` location, `typeName`→`type`, `array.type`→`element`, `enum.values`→`entries`). When extending the converter, support both.
- **URI templates: only `{param}` placeholders** — no regex, no optional segments. Extracted params are always `string`. Validate/coerce inside `handle()`.
- **Output schema must match `handle()` return** — declaring `outputSchema()` but returning an unrelated shape surfaces a validation error to the client. Keep them in sync.
- **`McpResponse.error()` vs throwing** — `McpResponse.error(msg)` returns an MCP-protocol-shaped error response; throwing inside `handle()` emits a `tool.failed` observer event and surfaces a generic error to the client. Prefer `McpResponse.error()` for expected failures, throw for programmer errors.
- **Don't import `/observers` in app code** — that subpath is for Telescope-style collectors, not for general subscription. If you need tool-call logging in an app, prefer AI middleware or route-level observability instead.
- **Scaffolder registers via `registerMakeSpecs`** — `make:*` commands skip `bootApp()` for speed. Don't add boot-dependent logic to scaffolder stubs.
- **Provider boot order** — `McpProvider` registers web routes with the router, so the router provider must boot first. Auto-discovery handles this; don't add `McpProvider` manually before `@rudderjs/router` in a custom provider list.

## Key Imports

```ts
// Server + building blocks
import { McpServer, McpTool, McpResource, McpPrompt } from '@rudderjs/mcp'

// Response helpers
import { McpResponse } from '@rudderjs/mcp'

// Decorators
import { Name, Version, Instructions, Description, Handle } from '@rudderjs/mcp'

// Registration facade
import { Mcp } from '@rudderjs/mcp'
import type { McpWebEntry, McpWebBuilder } from '@rudderjs/mcp'

// OAuth 2.1 protection
import { oauth2McpMiddleware, registerOAuth2Metadata } from '@rudderjs/mcp'
import type { OAuth2McpOptions } from '@rudderjs/mcp'

// Runtime primitives (rarely needed in app code)
import { createSdkServer, startStdio, mountHttpTransport } from '@rudderjs/mcp'
import type { HttpTransportOptions } from '@rudderjs/mcp'

// Provider + testing
import { McpProvider, McpTestClient } from '@rudderjs/mcp'

// Observer registry — for collectors only, not app code
import { mcpObservers } from '@rudderjs/mcp/observers'
import type { McpObserverEvent, McpObserver, McpObserverRegistry } from '@rudderjs/mcp'

// Types
import type { McpServerMetadata, McpToolResult, McpPromptMessage, InjectToken } from '@rudderjs/mcp'
```

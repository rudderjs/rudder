# MCP (Model Context Protocol)

`@rudderjs/mcp` lets your app **expose tools, resources, and prompts** to external AI agents — Claude Code, Cursor, Windsurf, any MCP-compatible client. Agents can then call those tools to query your database, read your docs, kick off jobs, and more, without leaving their chat UI.

```ts
// app/Mcp/Tools/CurrentWeatherTool.ts
import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Get current weather for a location.')
export class CurrentWeatherTool extends McpTool {
  schema() {
    return z.object({ location: z.string().describe('City name') })
  }

  async handle(input: Record<string, unknown>) {
    return McpResponse.text(`Weather in ${input.location}: sunny, 22°C`)
  }
}
```

Register it on a server, expose the server at `/mcp/weather`, and an AI agent in Cursor can now call your tool.

::: tip MCP vs @rudderjs/ai
`@rudderjs/ai` is the **client** side — your app uses an AI agent to do something.
`@rudderjs/mcp` is the **server** side — an external AI agent uses your app to do something.
They stack: you can run an `@rudderjs/ai` agent internally that calls an MCP server running in the same process.
:::

---

## Setup

```bash
pnpm add @rudderjs/mcp
```

Register the provider — auto-discovered if you use `defaultProviders()`:

```ts
// bootstrap/providers.ts
import { McpProvider } from '@rudderjs/mcp'

export default [
  // ...other providers
  McpProvider,
]
```

No config file needed — servers are registered via code (`Mcp.web()` / `Mcp.local()`, covered below).

---

## Your first server

Three building blocks: **tools** (functions the agent calls), **resources** (data the agent reads), **prompts** (reusable prompt templates). You register the classes, not instances.

### Tool

```ts
// app/Mcp/Tools/CurrentWeatherTool.ts
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

The Zod `schema()` drives what the AI agent sees as the tool's input. `@Description` becomes the tool description.

**Structured output** — optional, advertises the response shape:

```ts
outputSchema() {
  return z.object({ temperature: z.number(), conditions: z.string() })
}
async handle(input) {
  return McpResponse.json({ temperature: 22, conditions: 'sunny' })
}
```

### Resource

Resources expose data the agent can read by URI. Two flavours:

```ts
// Static URI
@Description('Weather usage guidelines')
export class WeatherGuidelines extends McpResource {
  uri() { return 'weather://guidelines' }
  async handle() { return 'Always check conditions before...' }
}

// URI template — {param} placeholders
@Description('Weather for a specific city')
export class CityWeatherResource extends McpResource {
  uri() { return 'weather://city/{name}' }

  async handle(params?: Record<string, string>) {
    return `Weather in ${params?.name}: sunny, 22°C`
  }
}
```

Template resources auto-register via `ListResourceTemplates` — the agent sees the template, fills in the params, and calls `handle()` with them already extracted.

### Prompt

Prompts are reusable templates the agent can ask for by name:

```ts
@Description('Describe weather poetically')
export class DescribeWeatherPrompt extends McpPrompt {
  arguments() {
    return z.object({ location: z.string() })
  }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    return [{ role: 'user', content: `Describe weather in ${args.location} poetically.` }]
  }
}
```

### Server

A server bundles tools, resources, and prompts under one name:

```ts
// app/Mcp/Servers/WeatherServer.ts
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

**Register classes, not instances** — the runtime instantiates them via the DI container at boot. Constructor parameters are auto-resolved.

---

## Exposing the server

Two transports: **HTTP Streamable** (browsers, remote clients) and **stdio** (local CLIs). Register in a provider's `boot()` or a dedicated module loaded from `routes/`.

```ts
import { Mcp } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/Servers/WeatherServer.js'

// HTTP — mounted on your app at /mcp/weather
Mcp.web('/mcp/weather', WeatherServer)

// With middleware
Mcp.web('/mcp/weather', WeatherServer).middleware([rateLimitMw])

// Local stdio — runnable as a CLI
Mcp.local('weather', WeatherServer)
```

**HTTP** — an AI client (e.g. Claude Code) connects via:
```
https://your-app.com/mcp/weather
```

**Local** — the client launches the server over stdio:
```bash
pnpm rudder mcp:start weather
```

Useful CLI commands:

```bash
pnpm rudder mcp:list               # list registered servers
pnpm rudder mcp:start <name>       # run a local server over stdio
pnpm rudder mcp:inspector <name>   # launch the MCP Inspector UI
```

---

## Dependency injection in tools

Constructor params are auto-resolved from the DI container:

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

### Method-level DI (important for Vite/esbuild)

`design:paramtypes` reflection — the normal backbone of method-level DI — is **dropped by esbuild**, which means the reflection-based auto-inject that works under `tsc` silently no-ops under Vite. Use the `@Handle(...)` decorator with explicit tokens:

```ts
@Handle(GreetingService, Logger)
async handle(input: Record<string, unknown>, greeter: GreetingService, logger: Logger) {
  logger.info(greeter.say(input.name as string))
  return McpResponse.text('ok')
}
```

Explicit tokens > reflection. Always pass them if you use `@Handle`.

---

## OAuth 2.1 protection

Protect an HTTP endpoint with Bearer tokens issued by `@rudderjs/passport`. The `.oauth2()` builder chains validation, scope enforcement, and the RFC 9728 Protected Resource Metadata endpoint that clients use for discovery:

```ts
Mcp.web('/mcp/admin', AdminServer).oauth2({
  scopes:              ['admin'],                        // required on the token
  authorizationServers: ['https://auth.example.com'],    // advertised in metadata
  scopesSupported:      ['admin', 'read', 'write'],      // shown in metadata
})
```

On auth failure, responses carry a `WWW-Authenticate` header pointing the client at the metadata doc at `/.well-known/oauth-protected-resource<mcp-path>`. Standard MCP client discovery flow just works.

Passport must be installed and configured — see the [`@rudderjs/passport` README](https://github.com/rudderjs/rudder/tree/main/packages/passport) for token issuance setup.

---

## Scaffolders

```bash
pnpm rudder make:mcp-server   Weather
pnpm rudder make:mcp-tool     CurrentWeather
pnpm rudder make:mcp-resource WeatherGuidelines
pnpm rudder make:mcp-prompt   DescribeWeather
```

Scaffolders land in `app/Mcp/{Servers,Tools,Resources,Prompts}/`.

---

## Testing

`McpTestClient` boots the server in-process — no network, no stdio spawn:

```ts
import { McpTestClient } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/Servers/WeatherServer.js'

const client = new McpTestClient(WeatherServer)

// Call a tool
const result = await client.callTool('current-weather', { location: 'London' })

// Assertions
client.assertToolExists('current-weather')
client.assertToolCount(1)
client.assertResourceExists('weather://guidelines')
client.assertPromptExists('describe-weather')

// Introspection
const tools     = await client.listTools()
const resources = await client.listResources()
const prompts   = await client.listPrompts()
```

---

## Observability

Every tool call, resource read, and prompt render fires a structured event. If `@rudderjs/telescope` is installed, they land in the dashboard automatically under the **MCP** tab — full input/output, timing, server name, errors.

For custom logging, subscribe to the observer registry:

```ts
import { mcpObservers } from '@rudderjs/mcp/observers'

mcpObservers.subscribe((event) => {
  // event.kind: 'tool.called' | 'tool.failed' | 'resource.read'
  //           | 'resource.failed' | 'prompt.rendered' | 'prompt.failed'
  console.log(`[${event.kind}] ${event.serverName}/${event.name} (${event.duration}ms)`)
})
```

The registry lives on `globalThis` so it survives Vite SSR module re-evaluation. Observer errors are swallowed inside `emit()` — a broken subscriber cannot break an MCP server.

---

## Common pitfalls

- **Register classes, not instances.** `protected tools = [MyTool]` — never `[new MyTool()]`. The runtime instantiates via DI.
- **`Mcp.web()` / `Mcp.local()` run once at boot.** Put them in a provider's `boot()` or a dedicated registration module loaded from `routes/`, not inside request handlers.
- **`.oauth2()` needs Passport.** Without `@rudderjs/passport` installed and configured, every request fails `invalid_token`.
- **Constructor DI works; method DI under Vite needs `@Handle(...)`.** esbuild drops `design:paramtypes`, so `@Handle()` without tokens silently falls back to empty. Always pass explicit tokens.
- **URI templates only support `{param}`.** No regex, no optional segments. Extracted params are always strings — validate/coerce inside `handle()`.
- **Output schema must match `handle()` return.** Declaring `outputSchema()` but returning a mismatched shape surfaces a validation error to the client.
- **`McpResponse.error()` vs throwing.** Use `McpResponse.error(msg)` for expected failures (returns MCP-shaped error). Throw for programmer errors — throws emit a `tool.failed` observer event and surface a generic error to the client.
- **Don't import `/observers` in app code.** That subpath is meant for Telescope-style collectors. For app-level tool-call logging, use AI middleware or route observability.
- **Provider boot order.** `McpProvider` registers HTTP routes with the router, so the router provider must boot first. Auto-discovery handles this — don't add `McpProvider` manually before `@rudderjs/router` in a custom provider list.

---

## Next Steps

- [AI](/guide/ai) — the client side: run agents that call tools (including tools from your own MCP servers)
- [Authentication](/guide/rudder) — set up `@rudderjs/passport` for OAuth 2.1 protection
- [MCP package README](https://github.com/rudderjs/rudder/tree/main/packages/mcp) — full reference: server metadata, transport options, runtime primitives

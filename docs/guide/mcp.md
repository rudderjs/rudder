# MCP

`@rudderjs/mcp` lets your application expose tools, resources, and prompts to external AI agents — Claude Code, Cursor, Windsurf, any MCP-compatible client. Once you register an MCP server in your app, an external agent can query your database, kick off jobs, fetch documents, and run domain-specific commands without leaving its chat UI.

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

Register the tool on a server, expose the server at `/mcp/weather`, and an AI agent in any MCP client can call it.

> **MCP vs `@rudderjs/ai`.** `@rudderjs/ai` is the client side — your app uses an AI agent to do something. `@rudderjs/mcp` is the server side — an external AI agent uses your app to do something. They compose: an `@rudderjs/ai` agent can call an MCP server running in the same process.

## Setup

```bash
pnpm add @rudderjs/mcp
```

The `McpProvider` is auto-discovered. No config file needed — servers are registered via code.

## The three primitives

An MCP server exposes three kinds of capabilities:

- **Tools** — functions the agent calls (most common)
- **Resources** — data the agent reads (URIs the agent can fetch)
- **Prompts** — reusable prompt templates the agent loads

You register the classes, not instances.

```ts
// app/Mcp/WeatherServer.ts
import { McpServer } from '@rudderjs/mcp'
import { CurrentWeatherTool } from './Tools/CurrentWeatherTool.js'
import { ForecastTool } from './Tools/ForecastTool.js'

export class WeatherServer extends McpServer {
  name() { return 'Weather' }

  tools()     { return [CurrentWeatherTool, ForecastTool] }
  resources() { return [] }
  prompts()   { return [] }
}
```

## Exposing the server

Two transports: **HTTP/SSE (web)** for remote agents, **stdio (local)** for local agents like Claude Desktop. Both register the same server class.

### HTTP/SSE

```ts
// routes/api.ts
import { Mcp } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/WeatherServer.js'

Mcp.web('/mcp/weather', WeatherServer)
```

Visit `http://localhost:3000/mcp/weather` to see the SSE endpoint. To gate access, add `.oauth2(...)` (see Authentication below).

### Stdio

```ts
// routes/console.ts
import { Mcp } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/WeatherServer.js'

Mcp.local('mcp:weather', WeatherServer)
```

The first argument is a lookup key, not a CLI command name. Run the server with the stdio runner: `pnpm rudder mcp:start mcp:weather` — Claude Desktop or any stdio MCP client can spawn this process and talk to your server.

## Tools with rich input

Zod schemas drive what the agent sees:

```ts
@Description('Search posts by query string and tag.')
export class SearchPostsTool extends McpTool {
  schema() {
    return z.object({
      query: z.string().describe('Full-text search query'),
      tags:  z.array(z.string()).optional().describe('Filter by tags'),
      limit: z.number().int().min(1).max(50).default(10),
    })
  }

  async handle({ query, tags, limit }) {
    const posts = await Post.search(query, { tags, limit })
    return McpResponse.json(posts)
  }
}
```

For tools that need DI, use `@Handle(Token1, Token2, ...)` to inject deps:

```ts
import { Handle } from '@rudderjs/mcp'
import { PostService } from '../../Services/PostService.js'

export class SearchPostsTool extends McpTool {
  schema() { return z.object({ query: z.string() }) }

  @Handle(PostService)
  async handle({ query }, posts: PostService) {
    return McpResponse.json(await posts.search(query))
  }
}
```

## Streaming progress

For long-running tools, stream progress back to the agent:

```ts
async *handle({ url }) {
  yield { progress: 0,  message: 'Fetching...' }
  const html = await Http.get(url)
  yield { progress: 50, message: 'Parsing...' }
  const text = parseHtml(html.body)
  yield { progress: 100, message: 'Done' }
  return McpResponse.text(text)
}
```

`async function*` handlers yield `McpToolProgress` objects and return the final result. The runtime forwards yields as `notifications/progress` when the client supplies a `progressToken`.

## Behavior annotations

Tools may carry MCP-spec hints that clients use to decide whether to auto-approve, batch, or sandbox a call. Apply them as decorators:

```ts
import { IsReadOnly, IsDestructive, IsIdempotent, IsOpenWorld } from '@rudderjs/mcp'

@IsReadOnly() @IsIdempotent()  class GetUserTool extends McpTool { /* ... */ }
@IsDestructive() @IsOpenWorld() class DeleteFileTool extends McpTool { /* ... */ }
```

Both `true` and `false` carry meaning per the spec, so the decorators take an explicit value: `@IsReadOnly()` is `true`, `@IsReadOnly(false)` is `false`, no decorator is omitted entirely. The hints are advisory — clients still apply their own policy.

Resources accept three protocol-level annotations: `@Audience('user' | 'assistant')`, `@Priority(0..1)`, and `@LastModified(string | Date)`. Clients use them to rank and surface resources in their UI.

## Conditional registration

Hide a primitive when a feature flag is off, in dev mode, or under any other static condition:

```ts
class ExperimentalTool extends McpTool {
  schema() { return z.object({}) }
  async handle() { return McpResponse.text('experimental') }
  shouldRegister() { return process.env.FEATURE_EXPERIMENTAL === 'true' }
}
```

Returning `false` hides the primitive from `tools/list` AND blocks `tools/call` (returning "Unknown tool"), so direct calls can't bypass the gate. The same hook works on `McpResource` and `McpPrompt`. Async hooks are supported. The hook runs with no arguments today; per-request gating (auth-scoped tools) is roadmap work — see `docs/plans/2026-05-09-mcp-roadmap.md`.

## Resources and prompts

```ts
@Description('Latest weather report')
export class LatestReport extends McpResource {
  uri()  { return 'weather://latest' }
  async read() { return McpResponse.text(await fetchLatestReport()) }
}

@Description('Compose a weather summary')
export class WeatherSummaryPrompt extends McpPrompt {
  schema() { return z.object({ location: z.string() }) }
  async render({ location }) {
    return McpResponse.prompt(`Summarize today's weather in ${location} for a casual reader.`)
  }
}
```

Resources can use URI templates: `weather://{city}` accepts `weather://paris` and exposes `city: 'paris'` to `read()`.

## Authentication

Gate HTTP/SSE servers with OAuth 2 + scopes (via `@rudderjs/passport`):

```ts
Mcp.web('/mcp/weather', WeatherServer).oauth2({
  scopes:           ['weather:read'],
  scopesSupported: ['weather:read', 'weather:write'],
})
```

The framework serves an RFC 9728 protected-resource metadata endpoint at `/.well-known/oauth-protected-resource/mcp/weather` so MCP clients can discover the auth requirements. Bearer tokens missing the required scope get a 403 with `WWW-Authenticate: insufficient_scope`.

## The inspector

`pnpm rudder mcp:inspector [--port 9100]` boots a zero-dependency dev UI. Open it in a browser, pick one of your registered servers, and call tools / read resources / render prompts directly. In-process invocation means DI works.

## Testing

```ts
import { McpTestClient } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/WeatherServer.js'

const client = new McpTestClient(WeatherServer)
const result = await client.callTool('current-weather', { location: 'London' })

expect(result.content[0].text).toContain('London')
```

`McpTestClient` instantiates the server in-process and exercises the same dispatch path the HTTP transport uses — assertions match production behavior.

## Telescope integration

Install `@rudderjs/telescope` and tool calls, resource reads, and prompt renders show up in the Telescope UI with input/output, duration, and the request that triggered them. The MCP runtime publishes events to the observer registry on `globalThis` and the Telescope collector subscribes — no extra wiring.

## Pitfalls

- **Forgetting `Mcp.web(...)` / `Mcp.local(...)`.** Defining the server class doesn't expose it. Make sure the registration file runs — typically by importing it from `routes/api.ts` or `routes/console.ts`.
- **Method-level decorators relying on reflection.** `@Description` works on classes; `@Handle` works on `handle()` with explicit tokens. Other method-level decorators that need `design:paramtypes` are unreliable under Vite.
- **OAuth scope mismatch.** Tokens without the required scope return 403 with `WWW-Authenticate: insufficient_scope`. Match the IdP's token config to `scopes: [...]`.

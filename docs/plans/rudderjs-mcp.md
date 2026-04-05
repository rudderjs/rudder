# @rudderjs/mcp — Model Context Protocol Server Framework

**Date:** 2026-04-05
**Status:** Planning
**Inspiration:** [Laravel MCP](https://laravel.com/docs/13.x/mcp)
**Dependencies:** `@rudderjs/core`, `@rudderjs/router`

---

## What

`@rudderjs/mcp` lets you build MCP servers inside your RudderJS app — exposing tools, resources, and prompts that AI clients (Claude, ChatGPT, Cursor, etc.) can connect to.

This is **app-facing** — your app serves MCP endpoints that external AI agents consume. Different from `@rudderjs/boost` (dev-facing) and `@rudderjs/ai` (calls LLMs).

```
┌─────────────┐     MCP      ┌──────────────────┐
│  AI Client   │ ──────────► │  Your RudderJS    │
│  (Claude,    │  tools,     │  App              │
│   Cursor,    │  resources, │                   │
│   ChatGPT)   │  prompts    │  @rudderjs/mcp    │
└─────────────┘              └──────────────────┘
```

---

## Why

MCP is becoming the standard protocol for AI-to-app communication. Apps need to expose their functionality to AI agents — not just call them. Laravel ships this. We should too.

---

## Architecture

### Server

```ts
import { McpServer } from '@rudderjs/mcp'
import { Name, Version, Instructions } from '@rudderjs/mcp'

@Name('Weather Server')
@Version('1.0.0')
@Instructions('Provides weather data and forecasts.')
class WeatherServer extends McpServer {
  tools = [CurrentWeatherTool, ForecastTool]
  resources = [WeatherGuidelinesResource]
  prompts = [DescribeWeatherPrompt]
}
```

### Registration

```ts
// routes/ai.ts (or routes/mcp.ts)
import { Mcp } from '@rudderjs/mcp'

// HTTP/SSE transport — for remote AI clients
Mcp.web('/mcp/weather', WeatherServer)

// With middleware
Mcp.web('/mcp/weather', WeatherServer, [RequireToken('mcp:read')])

// Stdio transport — for local AI clients (CLI)
Mcp.local('weather', WeatherServer)
```

---

## Tools

### Definition

```ts
import { McpTool, Name, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Name('get-weather')
@Description('Fetches the current weather for a location.')
class CurrentWeatherTool extends McpTool {
  schema() {
    return {
      location: z.string().describe('The location to get weather for.'),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    }
  }

  async handle(input: { location: string; units: string }) {
    const weather = await WeatherService.get(input.location, input.units)
    return McpResponse.json(weather)
  }
}
```

### DI Support

```ts
@Description('Search users by query.')
class SearchUsersTool extends McpTool {
  schema() {
    return { query: z.string() }
  }

  async handle(input: { query: string }) {
    const users = await resolve(UserService).search(input.query)
    return McpResponse.json(users)
  }
}
```

### Output Schema (optional)

```ts
outputSchema() {
  return {
    temperature: z.number().describe('Temperature'),
    conditions: z.string().describe('Weather conditions'),
  }
}
```

---

## Resources

Expose data via URI patterns.

```ts
import { McpResource, Description } from '@rudderjs/mcp'

@Description('Application configuration and documentation.')
class AppDocsResource extends McpResource {
  uris() {
    return {
      'app://config': 'Application configuration',
      'app://routes': 'Registered routes',
    }
  }

  templates() {
    return {
      'app://models/{name}': 'Model schema for a specific model',
    }
  }

  async handle(uri: string) {
    if (uri === 'app://config') {
      return McpResponse.json(config())
    }
    if (uri === 'app://routes') {
      return McpResponse.text(router.list())
    }
    const match = uri.match(/^app:\/\/models\/(.+)$/)
    if (match) {
      return McpResponse.json(ModelRegistry.schema(match[1]))
    }
    return McpResponse.error('Not found')
  }
}
```

---

## Prompts

Reusable prompt templates with arguments.

```ts
import { McpPrompt, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Generate a summary of a database table.')
class SummarizeTablePrompt extends McpPrompt {
  arguments() {
    return {
      table: z.string().describe('The table name to summarize.'),
      format: z.enum(['brief', 'detailed']).default('brief'),
    }
  }

  async handle(input: { table: string; format: string }) {
    const schema = await getTableSchema(input.table)
    return McpResponse.text(
      `Summarize the "${input.table}" table (${schema.columns.length} columns). ` +
      `Format: ${input.format}. Schema: ${JSON.stringify(schema)}`
    )
  }
}
```

---

## Responses

```ts
import { McpResponse } from '@rudderjs/mcp'

McpResponse.text('Plain text content')
McpResponse.json({ key: 'value' })
McpResponse.markdown('# Heading\n\nContent...')
McpResponse.error('Something went wrong')
McpResponse.content('app://data', 'application/json', jsonString)
```

---

## Transports

### Web (HTTP/SSE)

For remote AI clients. Uses the app's HTTP server (Hono).

```ts
Mcp.web('/mcp/weather', WeatherServer)
// Client connects via: http://localhost:3000/mcp/weather
```

### Local (Stdio)

For local AI clients (Claude Code, Cursor). Runs as a Rudder command.

```ts
Mcp.local('weather', WeatherServer)
// Client connects via: rudder mcp:serve weather
```

```bash
# .mcp.json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["tsx", "node_modules/@rudderjs/cli/src/index.ts", "mcp:serve", "weather"]
    }
  }
}
```

---

## Authentication

```ts
import { RequireToken } from '@rudderjs/sanctum'
import { RequireAuth } from '@rudderjs/auth'

// API token auth
Mcp.web('/mcp/admin', AdminServer, [RequireToken('mcp:admin')])

// Session auth
Mcp.web('/mcp/user', UserServer, [RequireAuth()])
```

---

## CLI

```bash
rudder make:mcp-server WeatherServer     # scaffold server
rudder make:mcp-tool CurrentWeatherTool  # scaffold tool
rudder make:mcp-resource AppDocs         # scaffold resource
rudder make:mcp-prompt SummarizeTable    # scaffold prompt
rudder mcp:serve weather                 # run stdio server
rudder mcp:list                          # list registered servers + tools
```

---

## Testing

```ts
import { McpTestClient } from '@rudderjs/mcp/testing'

describe('WeatherServer', () => {
  const client = new McpTestClient(WeatherServer)

  it('get-weather tool returns data', async () => {
    const result = await client.callTool('get-weather', { location: 'London' })
    assert.ok(result.temperature)
  })

  it('resource returns config', async () => {
    const result = await client.getResource('app://config')
    assert.ok(result.content)
  })

  it('tool exists', () => {
    client.assertToolExists('get-weather')
  })
})
```

---

## Service Provider

```ts
// bootstrap/providers.ts
import { mcp } from '@rudderjs/mcp'

export default [
  mcp(),  // registers MCP routes + stdio commands
]
```

---

## Dependencies

- `@modelcontextprotocol/sdk` — official MCP SDK (handles protocol, transports)
- `zod` — schema definitions (already in the ecosystem)
- No AI provider SDKs — MCP is protocol-only

---

## Relationship to Other Packages

```
@rudderjs/ai       → Your app CALLS LLMs (Anthropic, OpenAI, etc.)
@rudderjs/mcp      → AI clients CALL your app (via MCP protocol)
@rudderjs/boost    → AI dev tools INSPECT your project (auto-CLAUDE.md, skills)
```

All three are independent. An app could use any combination.

---

## Implementation Order

| Phase | Effort | Priority |
|-------|--------|----------|
| 1. McpServer + McpTool + web transport | Medium | High |
| 2. McpResource + McpPrompt | Small | Medium |
| 3. Stdio transport + CLI commands | Small | Medium |
| 4. Testing utilities | Small | Medium |
| 5. CLI scaffolders (make:mcp-*) | Small | Low |

---

## Open Questions

1. **Decorator vs method** — `@Name('...')` decorator or `name() { return '...' }` method? Decorators match Laravel's PHP attributes but add reflect-metadata dependency.
2. **Schema** — use zod (consistent with our validation) or JSON Schema directly (consistent with MCP spec)?
3. **Streaming tools** — should tools support streaming responses for long-running operations?
4. **Tool composition** — should MCP tools be able to use `@rudderjs/ai` tools internally? (MCP tool wrapping an AI agent)

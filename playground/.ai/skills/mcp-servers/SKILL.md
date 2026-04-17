---
name: mcp-servers
description: Building MCP servers with tools, resources, prompts, decorators, and HTTP/stdio transports in RudderJS
---

# MCP Servers

## When to use this skill

Load this skill when you need to build a Model Context Protocol (MCP) server to expose tools, resources, and prompts to AI coding assistants and other MCP clients.

## Key concepts

- **McpServer**: Base class that declares which tools, resources, and prompts to register. Extend it and set `protected tools`, `resources`, and `prompts` arrays.
- **McpTool**: Base class for tools. Implement `schema()` (Zod) and `handle()`. Name auto-derived from class name (PascalCase -> kebab-case, minus "Tool" suffix).
- **McpResource**: Base class for resources. Implement `uri()` and `handle()`. Supports URI templates with `{param}` placeholders.
- **McpPrompt**: Base class for prompts. Implement `handle()` and optionally `arguments()` for a Zod schema.
- **Decorators**: `@Name`, `@Version`, `@Instructions`, `@Description` set metadata via reflect-metadata.
- **McpResponse**: Helper for building tool results (`McpResponse.text()`, `.json()`, `.error()`).
- **Transports**: stdio (local CLI) via `startStdio()`, HTTP/SSE (web) via `mountHttpTransport()`.
- **DI support**: Tool/resource/prompt classes are resolved via the framework's DI container when available, falling back to plain `new T()`.
- **McpTestClient**: In-memory test client for unit testing servers without transport overhead.

## Step-by-step

### 1. Create a tool

```ts
// app/Mcp/Tools/WeatherTool.ts
import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Get current weather for a city')
export class WeatherTool extends McpTool {
  // Name auto-derived: "WeatherTool" -> "weather"
  // Override with: name() { return 'get-weather' }

  schema() {
    return z.object({
      city: z.string().describe('City name'),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    })
  }

  // Optional: advertise the output structure
  outputSchema() {
    return z.object({
      temperature: z.number(),
      conditions: z.string(),
    })
  }

  async handle(input: Record<string, unknown>) {
    const { city, units } = input as { city: string; units: string }
    const data = await fetchWeather(city, units)
    return McpResponse.json({ temperature: data.temp, conditions: data.conditions })
  }
}
```

### 2. Create a resource

```ts
// app/Mcp/Resources/SchemaResource.ts
import { McpResource, Description } from '@rudderjs/mcp'

@Description('Returns the database schema')
export class SchemaResource extends McpResource {
  uri() { return 'db://schema' }
  mimeType() { return 'text/plain' }

  async handle() {
    const schema = await readFile('prisma/schema.prisma', 'utf-8')
    return schema
  }
}
```

### 3. Create a resource with URI template

```ts
// app/Mcp/Resources/TableResource.ts
import { McpResource, Description } from '@rudderjs/mcp'

@Description('Read rows from a database table')
export class TableResource extends McpResource {
  uri() { return 'db://tables/{tableName}' }  // {param} makes it a template
  mimeType() { return 'application/json' }

  async handle(params?: Record<string, string>) {
    const tableName = params?.tableName ?? 'unknown'
    const rows = await db.query(`SELECT * FROM ${tableName} LIMIT 100`)
    return JSON.stringify(rows, null, 2)
  }
}
```

### 4. Create a prompt

```ts
// app/Mcp/Prompts/ReviewPrompt.ts
import { McpPrompt, Description } from '@rudderjs/mcp'
import type { McpPromptMessage } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Generate a code review prompt for a file')
export class ReviewPrompt extends McpPrompt {
  // Name auto-derived: "ReviewPrompt" -> "review"

  arguments() {
    return z.object({
      file: z.string().describe('Path to the file to review'),
      focus: z.string().optional().describe('Area to focus on'),
    })
  }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    const { file, focus } = args as { file: string; focus?: string }
    const content = await readFile(file, 'utf-8')

    return [
      {
        role: 'user',
        content: `Please review this code${focus ? ` with focus on ${focus}` : ''}:\n\n${content}`,
      },
    ]
  }
}
```

### 5. Assemble the server

```ts
// app/Mcp/AppMcpServer.ts
import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'
import { WeatherTool } from './Tools/WeatherTool.js'
import { SchemaResource } from './Resources/SchemaResource.js'
import { TableResource } from './Resources/TableResource.js'
import { ReviewPrompt } from './Prompts/ReviewPrompt.js'

@Name('my-app-mcp')
@Version('1.0.0')
@Instructions('An MCP server for my application. Use the weather tool to check conditions.')
export class AppMcpServer extends McpServer {
  protected tools = [WeatherTool]
  protected resources = [SchemaResource, TableResource]
  protected prompts = [ReviewPrompt]
}
```

### 6. Register for stdio transport (local CLI)

```ts
// routes/console.ts or bootstrap
import { Mcp } from '@rudderjs/mcp'
import { AppMcpServer } from '../app/Mcp/AppMcpServer.js'

Mcp.local('app', AppMcpServer)

// Run via: pnpm rudder mcp:start app
```

### 7. Register for HTTP transport (web endpoint)

```ts
// routes/console.ts or a provider's boot()
import { Mcp } from '@rudderjs/mcp'
import { AppMcpServer } from '../app/Mcp/AppMcpServer.js'

Mcp.web('/mcp', AppMcpServer)

// Optionally add middleware:
Mcp.web('/mcp', AppMcpServer).middleware([rateLimitMiddleware])

// The endpoint handles:
// POST /mcp — JSON-RPC messages
// GET  /mcp — SSE stream for server-initiated notifications
// DELETE /mcp — session termination
```

### 8. Register the MCP service provider

```ts
// bootstrap/providers.ts
import { mcp } from '@rudderjs/mcp'

export default [
  ...(await defaultProviders()),
  mcp(),  // registers Mcp facade + boots web/local servers + CLI commands
]
```

### 9. McpResponse helpers

```ts
import { McpResponse } from '@rudderjs/mcp'

// Text response
return McpResponse.text('The weather is sunny')

// JSON response (pretty-printed)
return McpResponse.json({ temp: 72, conditions: 'sunny' })

// Error response
return McpResponse.error('City not found')

// Raw response (for images etc.)
return {
  content: [
    { type: 'text', text: 'Here is the chart:' },
    { type: 'image', data: base64Data, mimeType: 'image/png' },
  ],
}
```

### 10. Testing with McpTestClient

```ts
import { McpTestClient } from '@rudderjs/mcp'
import { AppMcpServer } from './AppMcpServer.js'

const client = new McpTestClient(AppMcpServer)

// List tools
const tools = await client.listTools()
// [{ name: 'weather', description: 'Get current weather...' }]

// Call a tool
const result = await client.callTool('weather', { city: 'Paris', units: 'celsius' })

// Read a resource
const schema = await client.readResource('db://schema')

// Get a prompt
const messages = await client.getPrompt('review', { file: 'src/index.ts' })

// Assertions
client.assertToolExists('weather')
client.assertToolCount(1)
client.assertResourceExists('db://schema')
client.assertResourceCount(2)
client.assertPromptExists('review')
client.assertPromptCount(1)
```

### 11. DI-injected tools

```ts
import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import { injectable, inject } from 'tsyringe'
import { z } from 'zod'

@injectable()
@Description('Search the knowledge base')
export class SearchTool extends McpTool {
  constructor(@inject('search.service') private search: SearchService) {
    super()
  }

  schema() {
    return z.object({ query: z.string() })
  }

  async handle(input: Record<string, unknown>) {
    const results = await this.search.query(input.query as string)
    return McpResponse.json(results)
  }
}
// When the RudderJS DI container is available, tools are resolved via
// container.make(ToolClass), auto-injecting constructor dependencies.
```

## Examples

See `packages/mcp/src/index.test.ts` for test examples and `packages/mcp/src/runtime.ts` for the full transport implementation.

## Common pitfalls

- **Name derivation**: `WeatherTool` -> `weather`, `GetUserInfoTool` -> `get-user-info`. The class name is converted to kebab-case with the `Tool` suffix removed. Override `name()` if the auto-derived name isn't what you want.
- **Schema must be z.object()**: Both `schema()` and `arguments()` must return `z.object(...)`, not a bare `z.string()` or other type.
- **@modelcontextprotocol/sdk peer dep**: The MCP SDK (`@modelcontextprotocol/sdk`) is a peer dependency. Install it alongside `@rudderjs/mcp`.
- **HTTP transport requires @rudderjs/router**: `mountHttpTransport()` dynamically imports `@rudderjs/router` to register the endpoint. Stdio transport has no such requirement.
- **URI template matching**: Template resources use `{param}` syntax (e.g. `db://tables/{name}`). The extracted params are passed to `handle(params)`.
- **Error handling**: If `handle()` throws, the runtime catches it and returns `McpResponse.error(err.message)` automatically. You don't need try/catch in every tool.
- **mcp:list command**: Run `pnpm rudder mcp:list` to see all registered MCP servers (web and local).

# @rudderjs/mcp

MCP (Model Context Protocol) server framework for RudderJS. Build custom MCP servers that expose your application's functionality to AI agents.

## Installation

```bash
pnpm add @rudderjs/mcp
```

## Setup

Add to your providers:

```ts
// bootstrap/providers.ts
import { mcp } from '@rudderjs/mcp'

export default [..., mcp()]
```

## Defining a Server

```ts
// app/Mcp/Servers/WeatherServer.ts
import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'

@Name('Weather Server')
@Version('1.0.0')
@Instructions('Provide weather information and forecasts.')
export class WeatherServer extends McpServer {
  protected tools = [CurrentWeatherTool]
  protected resources = [WeatherGuidelinesResource]
  protected prompts = [DescribeWeatherPrompt]
}
```

## Tools

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
    return McpResponse.text(`Weather in ${location}: sunny, 22C`)
  }
}
```

## Resources

```ts
import { McpResource, Description } from '@rudderjs/mcp'

@Description('Weather usage guidelines')
export class WeatherGuidelinesResource extends McpResource {
  uri() { return 'weather://guidelines' }
  async handle() { return 'Always check conditions before...' }
}
```

## Prompts

```ts
import { McpPrompt, Description } from '@rudderjs/mcp'
import type { McpPromptMessage } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Describe weather poetically')
export class DescribeWeatherPrompt extends McpPrompt {
  arguments() {
    return z.object({ location: z.string() })
  }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    return [{ role: 'user', content: `Describe the weather in ${args.location} poetically.` }]
  }
}
```

## Output Schemas

Tools can declare an output schema to advertise the structure of their response:

```ts
@Description('Get current weather data.')
export class CurrentWeatherTool extends McpTool {
  schema() {
    return z.object({ location: z.string() })
  }

  outputSchema() {
    return z.object({
      temperature: z.number(),
      conditions: z.string(),
      humidity: z.number(),
    })
  }

  async handle(input: Record<string, unknown>) {
    return McpResponse.json({ temperature: 22, conditions: 'sunny', humidity: 45 })
  }
}
```

## Resource URI Templates

Resources can use `{param}` placeholders for dynamic data:

```ts
@Description('Weather data for a specific city')
export class CityWeatherResource extends McpResource {
  uri() { return 'weather://city/{name}' }

  async handle(params?: Record<string, string>) {
    const city = params?.name ?? 'unknown'
    return `Weather in ${city}: sunny, 22°C`
  }
}
```

Template resources are automatically registered via `ListResourceTemplates`. Parameters are extracted from the URI and passed to `handle()`.

## Dependency Injection

When running inside a RudderJS app, tool/resource/prompt classes are resolved via the DI container — constructor dependencies are auto-injected:

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

Falls back to plain `new T()` when the DI container is not available.

## Registration

```ts
// routes/ai.ts
import { Mcp } from '@rudderjs/mcp'
import { WeatherServer } from '../app/Mcp/Servers/WeatherServer.js'

// HTTP endpoint (Streamable HTTP transport)
Mcp.web('/mcp/weather', WeatherServer)

// With middleware (auth, rate limiting, etc.)
Mcp.web('/mcp/weather', WeatherServer)
  .middleware([authMiddleware])

// Local CLI command (stdio transport)
Mcp.local('weather', WeatherServer)
```

## CLI Commands

```bash
rudder mcp:start weather    # Start a local server via stdio
rudder mcp:list             # List all registered MCP servers
```

## Scaffolding

```bash
rudder make:mcp-server Weather
rudder make:mcp-tool CurrentWeather
rudder make:mcp-resource WeatherGuidelines
rudder make:mcp-prompt DescribeWeather
```

## Testing

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

// List
const tools = await client.listTools()
const resources = await client.listResources()
const prompts = await client.listPrompts()
```

## Response Helpers

```ts
import { McpResponse } from '@rudderjs/mcp'

McpResponse.text('Plain text output')
McpResponse.json({ key: 'value' })
McpResponse.error('Something went wrong')
```

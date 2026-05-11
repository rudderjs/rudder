# MCP Tools

## Basic tool

```ts
// app/Mcp/Tools/WeatherTool.ts
import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Get current weather for a city')
export class WeatherTool extends McpTool {
  // Name auto-derived: "WeatherTool" → "weather"
  // Override: name() { return 'get-weather' }

  schema() {
    return z.object({
      city:  z.string().describe('City name'),
      units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    })
  }

  outputSchema() {
    return z.object({
      temperature: z.number(),
      conditions:  z.string(),
    })
  }

  async handle(input: Record<string, unknown>) {
    const { city, units } = input as { city: string; units: string }
    const data = await fetchWeather(city, units)
    return McpResponse.json({ temperature: data.temp, conditions: data.conditions })
  }
}
```

`outputSchema()` is optional — declaring it lets MCP clients type-check the response.

## Response helpers

```ts
import { McpResponse } from '@rudderjs/mcp'

return McpResponse.text('The weather is sunny')                            // plain text
return McpResponse.json({ temp: 72, conditions: 'sunny' })                 // pretty-printed JSON
return McpResponse.error('City not found')                                 // error response

// Multi-part response (e.g. image + caption)
return {
  content: [
    { type: 'text',  text: 'Here is the chart:' },
    { type: 'image', data: base64Data, mimeType: 'image/png' },
  ],
}
```

## Name derivation

| Class name | Tool name |
|---|---|
| `WeatherTool` | `weather` |
| `GetUserInfoTool` | `get-user-info` |
| `SQLQueryTool` | `s-q-l-query` ⚠️ (override with `name()`) |

Override when the auto-derived name is awkward:

```ts
export class SQLQueryTool extends McpTool {
  name() { return 'sql-query' }
}
```

## Pitfalls

❌ **Don't** return a bare `z.string()` from `schema()`:

```ts
schema() { return z.string() }   // MCP rejects — tool input must be an object
```

✅ **Do** wrap in `z.object()`:

```ts
schema() { return z.object({ query: z.string() }) }
```

❌ **Don't** wrap `handle()` in try/catch just to call `McpResponse.error`:

```ts
async handle(input) {
  try { return await doWork(input) }
  catch (e) { return McpResponse.error(String(e)) }
}
```

✅ **Do** let it throw — the runtime catches and wraps automatically:

```ts
async handle(input) { return await doWork(input) }
```

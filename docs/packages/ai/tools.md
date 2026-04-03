# Tools

Tools give agents the ability to take actions — search databases, update records, call APIs, or interact with the browser.

## Defining Tools

```ts
import { toolDefinition } from '@boostkit/ai'
import { z } from 'zod'

const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['C', 'F']).optional(),
  }),
  needsApproval: true,  // requires user approval before execution
  lazy: true,           // not sent to LLM upfront — activated dynamically
}).server(async ({ location, unit }) => {
  const data = await fetchWeather(location)
  return { temp: data.temp, unit: unit ?? 'C' }
})
```

## Server vs Client Tools

```ts
// Server tool — executes on the backend
const dbTool = toolDefinition({
  name: 'query_db',
  description: 'Query the database',
  inputSchema: z.object({ sql: z.string() }),
}).server(async ({ sql }) => db.raw(sql))

// Client tool — executes in the browser
const themeTool = toolDefinition({
  name: 'set_theme',
  description: 'Apply a UI theme',
  inputSchema: z.object({ theme: z.enum(['light', 'dark']) }),
}).client(async ({ theme }) => {
  document.body.className = theme
  return 'Theme applied'
})
```

## Tool Options

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Unique tool name |
| `description` | `string` | Explains to the LLM when to use this tool |
| `inputSchema` | `z.ZodObject` | Zod schema for tool arguments |
| `needsApproval` | `boolean` | If `true`, requires user confirmation before execution |
| `lazy` | `boolean` | If `true`, not included in initial LLM request — activated via `prepareStep()` |

## Using Tools with Agents

```ts
import { agent } from '@boostkit/ai'

const a = agent({
  instructions: 'You help users check the weather.',
  tools: [weatherTool],
})

const response = await a.prompt('What is the weather in Paris?')
// Agent calls get_weather({ location: 'Paris' }), gets result, responds
```

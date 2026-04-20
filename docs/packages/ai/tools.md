# Tools

Tools give agents the ability to take actions — search databases, update records, call APIs, or interact with the browser.

## Defining Tools

```ts
import { toolDefinition } from '@rudderjs/ai'
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

## Shrinking what the model sees with `.modelOutput()`

A server tool returns its full structured result to the **UI** (via telemetry, stream chunks, observers). By default the model sees that same JSON on its next step — but large results eat context for no reason when the model only needs a summary. Use `.modelOutput(fn)` to map result → model-facing string while leaving the UI's view untouched:

```ts
const searchTool = toolDefinition({
  name: 'search_docs',
  description: 'Full-text search across the docs',
  inputSchema: z.object({ query: z.string() }),
})
  .server(async ({ query }) => ({
    results: await docs.search(query),   // [{ title, url, snippet }, ...]
    total:   await docs.count(query),
  }))
  .modelOutput((r) => `Found ${r.total} results. Top: ${r.results.slice(0, 3).map(x => x.title).join(', ')}`)
```

The UI stream chunk still carries `{ results, total }`. The model just sees the summary string on its next step.

## Streaming tools (`async function*`)

A server tool's `execute` can be an async generator — yield progress chunks mid-execution so the UI can show a live status while the tool is running:

```ts
const researchTool = toolDefinition({
  name: 'deep_research',
  description: 'Research a topic across multiple sources',
  inputSchema: z.object({ topic: z.string() }),
}).server(async function* ({ topic }) {
  yield { type: 'progress', message: 'Searching the web...' }
  const hits = await web.search(topic)

  yield { type: 'progress', message: `Reading ${hits.length} sources...` }
  const summaries = await Promise.all(hits.map(h => summarize(h)))

  return { summaries }  // final result — becomes the model-visible tool result
})
```

Yielded values surface as `tool-update` chunks in the streaming pipeline. The `return` value is the actual tool result that reaches the model. Pair with `.modelOutput()` to keep the model's next-step context lean even when the UI gets rich progress.

> **Never accept an `SSESend` parameter in a streaming tool.** Tools are authored as `async function*` generators — the framework owns the transport. Taking an `SSESend` callback ties the tool to a specific transport and breaks fake-adapter testing.

## Using Tools with Agents

```ts
import { agent } from '@rudderjs/ai'

const a = agent({
  instructions: 'You help users check the weather.',
  tools: [weatherTool],
})

const response = await a.prompt('What is the weather in Paris?')
// Agent calls get_weather({ location: 'Paris' }), gets result, responds
```

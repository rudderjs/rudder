# Testing + DI

## In-memory testing with `McpTestClient`

```ts
import { McpTestClient } from '@rudderjs/mcp'
import { AppMcpServer } from './AppMcpServer.js'

const client = new McpTestClient(AppMcpServer)

// List
const tools = await client.listTools()
// [{ name: 'weather', description: 'Get current weather...' }]

// Call a tool
const result = await client.callTool('weather', { city: 'Paris', units: 'celsius' })

// Read a resource (supports URI templates)
const schema = await client.readResource('db://schema')
const rows   = await client.readResource('db://tables/users')

// Get a prompt
const messages = await client.getPrompt('review', { file: 'src/index.ts' })
```

## Assertions

```ts
client.assertToolExists('weather')
client.assertToolCount(1)
client.assertResourceExists('db://schema')
client.assertResourceCount(2)
client.assertPromptExists('review')
client.assertPromptCount(1)
```

Useful as guardrails when you add or rename tools — `assertToolCount(N)` will catch an accidental extra registration.

## DI-injected tools

When a RudderJS DI container is available (the framework boot path), tool classes resolve through it. Constructor dependencies are auto-injected:

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

  schema() { return z.object({ query: z.string() }) }

  async handle(input: Record<string, unknown>) {
    const results = await this.search.query(input['query'] as string)
    return McpResponse.json(results)
  }
}
```

Without a container, the runtime falls back to plain `new T()` — works for tools with no dependencies.

## Pitfalls

❌ **Don't** rely on DI in unit tests that bypass the framework:

```ts
const tool = new SearchTool()   // ❌ search.service not injected
```

✅ **Do** stub the dependency manually in tests:

```ts
class FakeSearch { async query() { return [] } }
const tool = new SearchTool(new FakeSearch())
```

❌ **Don't** share state between tool invocations:

```ts
export class CounterTool extends McpTool {
  private count = 0                            // ❌ shared across calls — race-prone
  async handle() { return McpResponse.text(String(++this.count)) }
}
```

✅ **Do** keep state in the response or in an injected store:

```ts
@injectable()
export class CounterTool extends McpTool {
  constructor(@inject('counter.store') private store: CounterStore) { super() }
  async handle() { return McpResponse.text(String(await this.store.increment())) }
}
```

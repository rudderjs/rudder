# Agents

Agents are the core abstraction in `@rudderjs/ai`. An agent has instructions, tools, and a model — it runs a multi-step loop where the LLM can call tools and reason about results.

## Agent Class

```ts
import { Agent, toolDefinition, stepCountIs } from '@rudderjs/ai'
import type { HasTools } from '@rudderjs/ai'
import { z } from 'zod'

const searchTool = toolDefinition({
  name: 'search_users',
  description: 'Search users by name',
  inputSchema: z.object({ query: z.string() }),
}).server(async ({ query }) => {
  return db.users.findMany({ where: { name: { contains: query } } })
})

class SearchAgent extends Agent implements HasTools {
  instructions() { return 'You help find users in the system.' }
  model() { return 'anthropic/claude-sonnet-4-5' }
  tools() { return [searchTool] }
  stopWhen() { return stepCountIs(5) }
}

const response = await new SearchAgent().prompt('Find all admins')
console.log(response.text)         // "I found 3 admin users..."
console.log(response.usage)        // { promptTokens, completionTokens, totalTokens }
console.log(response.steps.length) // number of LLM rounds
```

## Anonymous Agent

For quick one-off agents:

```ts
import { agent, AI } from '@rudderjs/ai'

// Inline agent with instructions
const response = await agent('You summarize text.').prompt('Summarize this...')

// Via the AI facade (uses default model)
const response = await AI.prompt('Hello world')

// With tools
const a = agent({
  instructions: 'You help with tasks.',
  tools: [searchTool],
  model: 'openai/gpt-4o',
})
const response = await a.prompt('Find user John')
```

## Streaming

```ts
const { stream, response } = agent('You are helpful.').stream('Tell me a story')

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'text-delta':
      process.stdout.write(chunk.text!)
      break
    case 'tool-call':
      console.log('Tool called:', chunk.toolCall?.name)
      break
    case 'finish':
      console.log('Done:', chunk.finishReason)
      break
  }
}

const final = await response // full AgentResponse when stream completes
```

### Stream Chunk Types

| Type | Fields | Description |
|---|---|---|
| `text-delta` | `text` | Incremental text from the LLM |
| `tool-call-delta` | `toolCall` (partial) | Partial tool call arguments |
| `tool-call` | `toolCall` | Completed tool call (after execution) |
| `usage` | `usage` | Token usage update |
| `finish` | `usage`, `finishReason` | Stream finished |

## Agent Response

```ts
interface AgentResponse {
  text: string          // final concatenated text
  steps: AgentStep[]    // each LLM round
  usage: TokenUsage     // { promptTokens, completionTokens, totalTokens }
  conversationId?: string
}
```

## Override Points

| Method | Default | Description |
|---|---|---|
| `instructions()` | *(required)* | System prompt |
| `model()` | Registry default | `'provider/model'` string |
| `tools()` | `[]` | Array of tool definitions |
| `maxSteps()` | `20` | Maximum LLM rounds |
| `temperature()` | Provider default | Sampling temperature |
| `maxTokens()` | Provider default | Max output tokens |
| `stopWhen()` | Never | Stop condition(s) |
| `prepareStep(ctx)` | Continue | Per-step control (add messages, tools, or stop) |

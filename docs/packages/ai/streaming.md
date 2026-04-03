# Streaming

Stream agent responses for real-time UI updates.

## Basic Streaming

```ts
import { agent } from '@boostkit/ai'

const { stream, response } = agent('You are helpful.').stream('Tell me a story')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') {
    process.stdout.write(chunk.text!)
  }
}

const final = await response
console.log(`Total tokens: ${final.usage.totalTokens}`)
```

## SSE Endpoint

Stream to the browser via Server-Sent Events:

```ts
import { Route } from '@boostkit/router'
import { AI } from '@boostkit/ai'

Route.post('/api/ai/stream', async (req) => {
  const { message } = await req.json()
  const { stream, response } = AI.agent('Be concise.').stream(message)

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`)
          )
        }
      }
      const result = await response
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ done: true, usage: result.usage })}\n\n`)
      )
      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
})
```

## Stream Chunk Types

| Type | Fields | When |
|---|---|---|
| `text-delta` | `text: string` | LLM generates text |
| `tool-call-delta` | `toolCall: Partial<ToolCall>` | Tool arguments streaming in |
| `tool-call` | `toolCall: ToolCall` | Tool call completed and executed |
| `usage` | `usage: TokenUsage` | Token usage update |
| `finish` | `usage`, `finishReason` | Stream finished |

## Middleware + Streaming

Middleware hooks fire during streaming:

- `onStart` — when the stream begins
- `onBeforeToolCall` — before each tool executes
- `onAfterToolCall` — after each tool returns
- `onFinish` — when the stream completes

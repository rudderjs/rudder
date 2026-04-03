# Middleware

AI middleware lets you intercept and modify agent behavior — logging, rate limiting, caching, or custom logic.

## Defining Middleware

```ts
import type { AiMiddleware } from '@boostkit/ai'

const loggingMiddleware: AiMiddleware = {
  name: 'logger',
  onStart(ctx) {
    console.log(`[AI] Request ${ctx.requestId} started`)
  },
  onFinish(ctx) {
    console.log(`[AI] Request ${ctx.requestId} — ${ctx.usage.totalTokens} tokens`)
  },
  onBeforeToolCall(ctx, toolName, args) {
    console.log(`[AI] Calling tool: ${toolName}`, args)
  },
  onAfterToolCall(ctx, toolName, result) {
    console.log(`[AI] Tool ${toolName} returned:`, result)
  },
}
```

## Using Middleware

### On an Agent Class

```ts
import { Agent } from '@boostkit/ai'
import type { HasMiddleware } from '@boostkit/ai'

class MyAgent extends Agent implements HasMiddleware {
  instructions() { return '...' }
  middleware() { return [loggingMiddleware] }
}
```

### On an Anonymous Agent

```ts
import { agent } from '@boostkit/ai'

const a = agent({
  instructions: '...',
  middleware: [loggingMiddleware],
})
```

## Middleware Hooks

| Hook | Arguments | Description |
|---|---|---|
| `onStart` | `ctx` | Agent run begins |
| `onFinish` | `ctx` | Agent run completes |
| `onBeforeToolCall` | `ctx, toolName, args` | Before a tool executes |
| `onAfterToolCall` | `ctx, toolName, result` | After a tool returns |

## Testing

```ts
import { AiFake } from '@boostkit/ai'

const fake = AiFake.fake()
fake.respondWith('Mocked response')

const response = await AI.prompt('Hello')
assert.strictEqual(response.text, 'Mocked response')

fake.assertPrompted(input => input.includes('Hello'))
fake.restore()
```

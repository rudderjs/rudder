---
'@rudderjs/ai': minor
---

Add `AbortSignal` support to `agent.prompt()` / `agent.stream()`. Pass `{ signal }` in `AgentPromptOptions` to cancel an in-flight run from outside:

```ts
const ac = new AbortController()
setTimeout(() => ac.abort(), 5000)
const r = await agent('You are helpful').prompt('long task', { signal: ac.signal })

// or just use AbortSignal.timeout
const r = await agent('...').prompt('go', { signal: AbortSignal.timeout(5000) })
```

Behavior:
- Pre-aborted signal → throws immediately, zero provider calls.
- Abort between iterations → loop stops at the next iteration boundary; `prompt()` rejects with the signal's reason.
- The signal is forwarded to provider adapters via `ProviderRequestOptions.signal`. Built-in adapters that pass it to the underlying SDK: `openai` (covers itself + azure/deepseek/groq/mistral/ollama/xai via the shared `OpenAIAdapter`), `anthropic`, `google`. Other adapters fall back to the iteration-level cancellation.
- Streaming variant: the stream throws and the `response` promise rejects with the same reason. Without `signal`, behavior is unchanged.

Without `signal`, behavior is identical to today.

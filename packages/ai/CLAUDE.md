# @rudderjs/ai

AI agent framework — Laravel ergonomics + Vercel/TanStack execution model + RudderJS-specific approval-resume flow.

## Key Files

- `src/agent.ts` — `Agent` base class: `instructions()`, `model()`, `tools()`, `stopWhen()`, `prompt()`, `stream()`, `asTool()` (subagents)
- `src/tool.ts` — `toolDefinition()`, `dynamicTool()`, `ToolBuilder`, pause control
- `src/types.ts` — `StreamChunk`, `FinishReason`, `ToolDefinition`, `AgentConfig`
- `src/providers/` — 8 provider adapters: anthropic, openai, google, ollama, deepseek, xai, groq, azure
- `src/middleware.ts` — Hooks: `runOnConfig`, `runOnChunk`, `runOnBeforeToolCall`, `runOnAfterToolCall`, `runOnUsage`
- `src/facade.ts` — `AI` convenience class for one-shot prompts
- `src/observers.ts` — Event observers for telescope telemetry (subpath export)
- `src/vercel-protocol.ts` — `toVercelResponse()` for Vercel AI SDK streaming compatibility
- `src/registry.ts` — Provider/model registry
- `src/fake.ts` — `AiFake` for testing without real API calls

## Runtime Compatibility

`@rudderjs/ai` is runtime-agnostic via subpath exports:

| Entry | Runtimes | Use for |
|---|---|---|
| `@rudderjs/ai` | Node, browser, Electron main+renderer, React Native | Agents, tools, streaming, providers — any `fetch`-capable JS runtime |
| `@rudderjs/ai/node` | Node only | `documentFromPath()`, `imageFromPath()`, `transcribeFromPath()` |
| `@rudderjs/ai/server` | Node only | `AiProvider` (requires `@rudderjs/core`) |

The main entry has **zero `node:` static imports** — enforced by `src/isomorphic-check.test.ts`. `@rudderjs/core` is an optional peer; only `/server` consumers pull it in.

Provider auto-discovery reads `rudderjs.providerSubpath` from `package.json` (`"./server"` here) so `defaultProviders()` imports the class from the right entry.

**Security caveat:** Calling LLM providers directly from a client (browser/RN) leaks your API key. Use server-side proxies for production; BYOK desktop apps (Electron) are the main client-side use case.

## Architecture Rules

- **Lazy SDK loading**: provider adapters import their SDK only on first use — all SDKs are optional peers
- **Streaming tools**: use `async function*` + `.modelOutput()` pattern; NEVER take an SSESend parameter
- **Client tools**: omit `execute` from the tool definition — the loop pauses and returns `pending-client-tools`
- **Approval gates**: `needsApproval: true` stops the loop with `tool_approval_required` finish reason
- **Zod schemas**: tool inputs defined with zod, converted to JSON Schema for each provider
- **Subagents**: `agent.asTool({ name, description })` wraps an agent as a tool a parent agent can call. Defaults: `inputSchema = { prompt: string }`, `modelOutput = response.text` (full `AgentResponse` still surfaces in the `tool-result` chunk for the UI). Pass `inputSchema` + `prompt` for a typed schema. Subagent runs via `prompt()`, not `stream()` — token deltas don't surface as `tool-update` chunks; write the wrapping tool by hand if you need that.

## Stream Chunk Types

`text-delta` | `tool-call` | `tool-result` | `tool-update` (progress) | `pending-client-tools` | `pending-approval`

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
pnpm test       # tsx --test
```

## Pitfalls

- Provider SDKs are optional — install only the ones you use (`@anthropic-ai/sdk`, `openai`, `@google/genai`)
- `exactOptionalPropertyTypes` in tsconfig causes issues if you pass `undefined` for optional tool params
- The `observers.ts` subpath export is for telescope integration — don't import it in normal app code

# @rudderjs/ai

> The AI engine moved to [`@gemstack/ai-sdk`](https://www.npmjs.com/package/@gemstack/ai-sdk). This package re-exports the engine for backwards compatibility **and** is the home of the Rudder-specific AI bindings that intentionally did not graduate to the framework-agnostic engine.

## Two kinds of module here

**1. Re-exported engine subpaths** — thin `export *` over `@gemstack/ai-sdk`. Migrate these by swapping the specifier; the API is identical.

```diff
- import { Agent } from '@rudderjs/ai'
+ import { Agent } from '@gemstack/ai-sdk'
```

| `@rudderjs/ai` subpath | `@gemstack/ai-sdk` equivalent |
|---|---|
| `@rudderjs/ai` | `@gemstack/ai-sdk` |
| `@rudderjs/ai/node` | `@gemstack/ai-sdk/node` |
| `@rudderjs/ai/mcp` | `@gemstack/ai-sdk/mcp` |
| `@rudderjs/ai/eval` | `@gemstack/ai-sdk/eval` |
| `@rudderjs/ai/computer-use` | `@gemstack/ai-sdk/computer-use` |
| `@rudderjs/ai/react` | `@gemstack/ai-sdk/react` |
| `@rudderjs/ai/observers`, `/chat-mentions`, `/gateway` | same subpath on `@gemstack/ai-sdk` |

**2. Rudder bindings** — real implementations that couple the agnostic engine to a Rudder package, so they live here (no `@gemstack/ai-sdk` equivalent). Keep importing them from `@rudderjs/ai`:

| Subpath | Couples to | What it is |
|---|---|---|
| `@rudderjs/ai/server` | `@rudderjs/core` | `AiProvider` — reads `config('ai')`, wires providers/stores into the container |
| `@rudderjs/ai/commands/make-agent` | `@rudderjs/console` | `make:agent` scaffolder spec |
| `@rudderjs/ai/commands/ai-eval` | `@rudderjs/core` | `ai:eval` CLI command (discovers + runs eval suites) |
| `@rudderjs/ai/doctor` | `@rudderjs/console` | `ai:provider-keys` doctor check |
| `@rudderjs/ai/{conversation,memory,budget}-orm`, `/memory-embedding` | `@rudderjs/orm` | ORM-backed stores implementing the engine's neutral contracts |

See the `@gemstack/ai-sdk` README for full engine documentation.

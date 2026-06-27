# @rudderjs/ai

> Rudder's AI integration. It re-exports the framework-agnostic agent engine from [`@gemstack/ai-sdk`](https://www.npmjs.com/package/@gemstack/ai-sdk) **and** is the home of the Rudder-specific AI bindings that intentionally did not graduate to the agnostic engine. In a Rudder app, this is the package you import.

## Two kinds of module here

**1. Re-exported engine subpaths** — thin `export *` over `@gemstack/ai-sdk`. In a Rudder app, import these from `@rudderjs/ai`; the API is identical to the engine. Import `@gemstack/ai-sdk` directly only if you want the engine without the Rudder bindings (e.g. outside Rudder).

```js
import { Agent } from '@rudderjs/ai'
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

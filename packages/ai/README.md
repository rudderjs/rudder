# @rudderjs/ai

> Deprecated. The AI engine moved to [`@gemstack/ai-sdk`](https://www.npmjs.com/package/@gemstack/ai-sdk).

This package is now a thin compatibility shim that re-exports `@gemstack/ai-sdk` (and every one of its subpaths) so existing Rudder apps and the internal dependents (`telescope`, `orm-prisma`, `orm-drizzle`) keep working unchanged.

## Migrate

Replace the import specifier; the API is identical.

```diff
- import { Agent } from '@rudderjs/ai'
+ import { Agent } from '@gemstack/ai-sdk'
```

Subpaths map one to one:

| Old | New |
|---|---|
| `@rudderjs/ai` | `@gemstack/ai-sdk` |
| `@rudderjs/ai/server` | `@gemstack/ai-sdk/server` |
| `@rudderjs/ai/node` | `@gemstack/ai-sdk/node` |
| `@rudderjs/ai/mcp` | `@gemstack/ai-sdk/mcp` |
| `@rudderjs/ai/eval` | `@gemstack/ai-sdk/eval` |
| `@rudderjs/ai/computer-use` | `@gemstack/ai-sdk/computer-use` |
| `@rudderjs/ai/react` | `@gemstack/ai-sdk/react` |
| `@rudderjs/ai/*` | `@gemstack/ai-sdk/*` |

See the `@gemstack/ai-sdk` README for full documentation.

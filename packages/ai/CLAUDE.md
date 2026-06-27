# @rudderjs/ai

Compatibility shim for the AI engine (now `@gemstack/ai-sdk`, repo: gemstack-land/gemstack) **plus** the Rudder-specific AI bindings that intentionally did *not* graduate to the agnostic engine.

## What lives here

- **Thin re-exports (the shim):** most `src/*.ts` are one-line re-export modules, each `export * from '@gemstack/ai-sdk/<subpath>'`. No logic.
- **Rudder-coupled bindings (real logic):** code that couples the agnostic engine to a Rudder package, so it lives here, not in `@gemstack/ai-sdk`. Each has tests alongside it.
  - `src/{conversation-orm,memory-orm,budget-orm,memory-embedding}/index.ts` — full ORM-backed store implementations that need `@rudderjs/orm`'s `Model`. They implement the engine's neutral contracts (`ConversationStore`, `UserMemory`, `BudgetStorage`) imported from `@gemstack/ai-sdk`, and persist via `@rudderjs/orm`.
  - `src/doctor.ts` — registers an AI doctor check into `@rudderjs/console`'s doctor registry (side-effect on import).
  - `src/server/provider.ts` (exported as `./server`) — `AiProvider`, the Rudder `ServiceProvider` that reads `config('ai')` (via `@rudderjs/core`) and wires the engine's providers/registry/stores into the container. The `GoogleCacheRegistry` and provider classes are imported from `@gemstack/ai-sdk`.
  - `src/commands/make-agent.ts` — `makeAgentSpec` for the `make:agent` scaffolder; needs `@rudderjs/console`'s `MakeSpec`. `AiProvider.boot()` lazy-imports it to self-register.
  - `src/commands/ai-eval.ts` — `registerAiEvalCommand` + the `ai:eval` CLI flow; reads `config('ai').eval.pattern` via `@rudderjs/core` and drives the engine's eval framework (`runSuite`, reporters, fixtures) from `@gemstack/ai-sdk/eval`. `AiFakeStep` is derived from the public `stepsFromResponse` return type (not on the engine's public surface).

The Rudder CLI loader (`packages/cli/src/index.ts`) imports `commands/make-agent` (`makeAgentSpec`) and `commands/ai-eval` (`registerAiEvalCommand`) from `@rudderjs/ai` by subpath, so those export names are load-bearing.
- `package.json` - depends on `@gemstack/ai-sdk`; keeps the `rudderjs.provider` metadata (`AiProvider` / `./server`) so provider auto-discovery still resolves; keeps the optional peer deps (`@rudderjs/core`, `@rudderjs/orm`, `@modelcontextprotocol/sdk`, `react`) and optional provider SDKs so consumers get the same install expectations.

## Working on the AI engine

Do the agnostic engine work in `@gemstack/ai-sdk`, not here. The source (agents, providers, tools, streaming, memory, eval, MCP bridge, computer-use, etc.) lives there. Add/remove a re-export subpath here only when `@gemstack/ai-sdk` adds/removes one. The exception is the Rudder-coupled bindings above: those are maintained here because they depend on `@rudderjs/orm`.

## Internal dependents

`telescope`, `orm-prisma`, `orm-drizzle` declare `@rudderjs/ai: workspace:^` as an optional peer. They keep working through the re-export; a later pass may repoint them directly at `@gemstack/ai-sdk`.

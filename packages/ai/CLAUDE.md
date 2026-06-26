# @rudderjs/ai

Compatibility shim for the AI engine (now `@gemstack/ai-sdk`, repo: gemstack-land/gemstack) **plus** the Rudder-specific AI bindings that intentionally did *not* graduate to the agnostic engine.

## What lives here

- **Thin re-exports (the shim):** most `src/*.ts` are one-line re-export modules, each `export * from '@gemstack/ai-sdk/<subpath>'`. No logic.
- **Rudder-coupled bindings (real logic):** `src/{conversation-orm,memory-orm,budget-orm,memory-embedding}/index.ts` are full implementations that need `@rudderjs/orm`'s `Model`. They live here, not in `@gemstack/ai-sdk`, because they couple the agnostic engine to the Rudder ORM. They implement the engine's neutral contracts (`ConversationStore`, `UserMemory`, `BudgetStorage`) imported from `@gemstack/ai-sdk`, and persist via `@rudderjs/orm`. Their tests live alongside them (`src/*-orm.test.ts`, `src/memory-embedding.test.ts`).
- `package.json` - depends on `@gemstack/ai-sdk`; keeps the `rudderjs.provider` metadata (`AiProvider` / `./server`) so provider auto-discovery still resolves; keeps the optional peer deps (`@rudderjs/core`, `@rudderjs/orm`, `@modelcontextprotocol/sdk`, `react`) and optional provider SDKs so consumers get the same install expectations.

## Working on the AI engine

Do the agnostic engine work in `@gemstack/ai-sdk`, not here. The source (agents, providers, tools, streaming, memory, eval, MCP bridge, computer-use, etc.) lives there. Add/remove a re-export subpath here only when `@gemstack/ai-sdk` adds/removes one. The exception is the Rudder-coupled bindings above: those are maintained here because they depend on `@rudderjs/orm`.

## Internal dependents

`telescope`, `orm-prisma`, `orm-drizzle` declare `@rudderjs/ai: workspace:^` as an optional peer. They keep working through the re-export; a later pass may repoint them directly at `@gemstack/ai-sdk`.

# @rudderjs/ai

Deprecated compatibility shim. The AI engine moved to `@gemstack/ai-sdk` (repo: gemstack-land/gemstack). This package re-exports it.

## What lives here

- `src/*.ts` - one thin re-export module per export subpath, each `export * from '@gemstack/ai-sdk/<subpath>'`. No logic.
- `package.json` - depends on `@gemstack/ai-sdk`; keeps the `rudderjs.provider` metadata (`AiProvider` / `./server`) so provider auto-discovery still resolves; keeps the optional peer deps (`@rudderjs/core`, `@rudderjs/orm`, `@modelcontextprotocol/sdk`, `react`) and optional provider SDKs so consumers get the same install expectations.

## Working on the AI engine

Do it in `@gemstack/ai-sdk`, not here. The source (agents, providers, tools, streaming, memory, eval, MCP bridge, computer-use, etc.) lives there. This package should only ever change when `@gemstack/ai-sdk` adds or removes an export subpath, in which case mirror it here.

## Internal dependents

`telescope`, `orm-prisma`, `orm-drizzle` declare `@rudderjs/ai: workspace:^` as an optional peer. They keep working through the re-export; a later pass may repoint them directly at `@gemstack/ai-sdk`.

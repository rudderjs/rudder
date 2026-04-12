# @rudderjs/router

Decorator-based routing — `@Controller`, `@Get/@Post/@Put/@Patch/@Delete`, `@Middleware`, signed URLs.

## Key Files

- `src/index.ts` — `Router`, route decorators, `route()` URL generator, `Url` signed URLs, signature validation middleware

## Architecture Rules

- **Peer of core**: uses `peerDependencies` for `@rudderjs/core` — never add core to `dependencies` (cycle)
- **Decorator metadata**: requires `reflect-metadata`, `experimentalDecorators`, `emitDecoratorMetadata`
- **Route registration**: decorators collect metadata; `Router` reads it during boot

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

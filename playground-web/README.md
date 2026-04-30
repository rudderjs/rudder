# rudderjs-playground-web

WebContainer-bootable variant of the canonical `playground/`. Designed to run inside StackBlitz / Bolt.new without native bindings or raw TCP sockets, so we can ship a "click → running RudderJS in your browser" link from the homepage.

> See `docs/plans/2026-04-30-webcontainer-playground.md` for the full plan, Phase 0 spike results, and Prisma 7 corrections.

## What's different from `playground/`

| Layer | `playground/` | `playground-web/` |
|---|---|---|
| Database | Prisma + better-sqlite3 (native binding) | Prisma + `@prisma/adapter-libsql` + `@libsql/client` (pure JS, WASM query compiler) |
| Cache | configurable | `memory` driver (auto-flipped via `isWebContainer()`) |
| Queue | configurable | `sync` driver (auto-flipped via `isWebContainer()`) |
| Mail | configurable | `log` driver (auto-flipped via `isWebContainer()`) |
| Session | configurable | `cookie` driver (auto-flipped via `isWebContainer()`) |
| Broadcast / Sync | WS server demos | omitted — raw TCP listening sockets do not work in WebContainer |

The runtime behaves identically to `playground/` outside WebContainer because `isWebContainer()` from `@rudderjs/support` returns `false` on a host Node, leaving `Env.get(...)` defaults intact.

## Booting locally

```bash
# from repo root
pnpm install
pnpm build

cd playground-web
pnpm dev                     # vike dev on :3000
```

The schema is pre-pushed into a committed `prisma/dev.db`, so no `prisma db push` step is needed for a fresh clone. If you change the Prisma schema, regenerate it:

```bash
pnpm exec prisma generate
pnpm exec prisma db push     # re-materializes prisma/dev.db with the new schema
git add prisma/dev.db        # commit it so WebContainer boots stay one-step
```

## Booting in WebContainer (StackBlitz)

`pnpm install && pnpm dev`. No extra setup — the committed `prisma/dev.db` carries the schema, and the Prisma runtime uses the WASM query compiler via `@prisma/adapter-libsql`, so the Rust query engine is never loaded.

End-to-end StackBlitz validation is Phase 4 of the plan, not yet executed.

## Dropped framework packages

These packages cannot work in WebContainer's sandboxed runtime and are removed from this variant's `package.json`:

- `@rudderjs/broadcast` — needs a raw TCP `WebSocket` server
- `@rudderjs/sync` — needs a raw TCP Yjs WebSocket server
- `@rudderjs/queue-bullmq` — Redis driver requires raw TCP
- `@prisma/adapter-better-sqlite3` — native `.node` binding
- `better-sqlite3`, `y-websocket`, `yjs`, `ws` — transitive natives or WS-server-only deps

Their demo pages (`/demos/live`, `/demos/ws`) and the `routes/channels.ts` file are also dropped. See the top-of-file comment in `routes/web.ts` for the canonical list.

## Why a separate variant?

Keeping `playground/` and `playground-web/` as siblings means:

1. The canonical playground stays pure — exercises the full framework including broadcast / sync.
2. The WebContainer variant stays small — only what fits in a sandboxed Node, no detection ceremony in user-facing code.
3. Both share the same `app/`, `routes/`, and view source — drift is bounded to `package.json`, `prisma/schema/`, and the four config files (`cache.ts` / `queue.ts` / `mail.ts` / `session.ts`).

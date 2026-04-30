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
pnpm exec prisma generate    # one time, after install / schema changes
pnpm exec prisma db push     # one time — sync schema → ./prisma/dev.db (host-side, before going to WebContainer)
pnpm dev                     # vike dev on :3000
```

> **Phase 3 deferred.** The DB schema is **not** yet pre-pushed into a committed `dev.db`. Run `pnpm exec prisma db push` once before the first `pnpm dev`. A future iteration will commit a pre-pushed `prisma/dev.db` so the WebContainer click-through-boot path works without invoking the Prisma migration engine (which is a Rust binary and won't run in the sandbox).

## Booting in WebContainer (StackBlitz)

The plan covers this in Phase 4 — not yet validated end-to-end. Once Phase 3 ships a pre-pushed `dev.db`, the WebContainer boot is `pnpm install && pnpm dev` with no extra steps.

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

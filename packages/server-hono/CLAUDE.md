# @rudderjs/server-hono

Hono.js server adapter — implements `ServerAdapter` from `@rudderjs/contracts`.

Normalizes Hono requests/responses, handles Vike SSR integration, WebSocket upgrade patching, and ViewResponse detection (duck-typed via `__rudder_view__`).

Peer of `@rudderjs/core` — never add core to `dependencies` (same cycle rule as router).

WebSocket upgrade must be patched at module load time, not lazily.

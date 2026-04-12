---
status: done
created: 2026-04-12
completed: 2026-04-12
---

# Plan: Telescope Phase 3.3 — HttpClient, Gate, Dump Collectors

## Overview

Three remaining watchers to close the Laravel Telescope parity gap. All three follow the established observer registry pattern: add a registry to the peer package, emit events at the right hook point, subscribe from a telescope collector.

No WebSocket push — all three use the same 2s auto-refresh polling as the existing 14 watchers. Live push for telescope is a separate future effort that would benefit all entry types.

**New entry types after this plan:** `http`, `gate`, `dump` (total: 17)

---

## Phase A — HttpClientCollector (~1.5h)

Records outgoing HTTP requests made through `@rudderjs/http` (`Http.get()`, `Http.post()`, etc.).

### A.1 — Observer registry in `@rudderjs/http`

**New file: `packages/http/src/observers.ts`**

```ts
export type HttpEvent =
  | {
      kind:       'request.completed'
      method:     string
      url:        string
      status:     number
      duration:   number       // ms
      reqHeaders: Record<string, string>
      reqBody:    unknown
      resHeaders: Record<string, string>
      resBody:    string       // raw text (truncated to 64KB)
      resSize:    number       // byte length of full response
    }
  | {
      kind:       'request.failed'
      method:     string
      url:        string
      duration:   number
      reqHeaders: Record<string, string>
      reqBody:    unknown
      error:      string       // error message
    }

export type HttpObserver = (event: HttpEvent) => void

export class HttpObserverRegistry {
  private observers: HttpObserver[] = []
  subscribe(fn: HttpObserver): () => void { ... }
  emit(event: HttpEvent): void { ... }  // swallow errors
  reset(): void { ... }
}

// Process-wide singleton
export const httpObservers: HttpObserverRegistry
```

Mirror the exact singleton pattern from `broadcastObservers` (`globalThis['__rudderjs_http_observers__']`).

### A.2 — Hook point in `PendingRequest._send()`

**File: `packages/http/src/index.ts`**, in the `_send()` method (line ~200).

Wrap the real-fetch + retry block to capture timing and emit:

```ts
// After the retry loop resolves (success):
const start = performance.now()
// ... existing fetch logic ...
const duration = Math.round(performance.now() - start)

httpObservers.emit({
  kind: 'request.completed',
  method, url: fullUrl,
  status: res.status, duration,
  reqHeaders: init.headers as Record<string, string>,
  reqBody: pending._body,
  resHeaders: /* from res */,
  resBody: res.body.slice(0, 65_536),
  resSize: res.body.length,
})
```

On error (after retries exhausted):
```ts
httpObservers.emit({
  kind: 'request.failed',
  method, url: fullUrl, duration,
  reqHeaders: init.headers as Record<string, string>,
  reqBody: pending._body,
  error: err instanceof Error ? err.message : String(err),
})
```

**Import `httpObservers` lazily** inside `_send()` to avoid module-load cost when telescope isn't installed. Use a top-level `let _obs` cache:

```ts
let _obs: HttpObserverRegistry | null | undefined
function getObs(): HttpObserverRegistry | null {
  if (_obs === undefined) {
    try { _obs = (globalThis as any)['__rudderjs_http_observers__'] ?? null }
    catch { _obs = null }
  }
  return _obs
}
```

This avoids importing observers.ts — the collector sets up the singleton, and http just reads it from globalThis if present. Same no-dependency approach as the other packages.

**Skip in fake mode.** Don't emit for `Http.fake()` responses — those are test doubles.

### A.3 — HttpCollector in telescope

**New file: `packages/telescope/src/collectors/http.ts`**

```ts
export class HttpCollector implements Collector {
  readonly name = 'HTTP Client Collector'
  readonly type = 'http' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { httpObservers } = await import('@rudderjs/http')
      httpObservers.subscribe((event) => this.record(event))
    } catch { /* @rudderjs/http not installed */ }
  }

  private record(event: HttpEvent): void {
    const tags: string[] = [`kind:${event.kind}`]
    if (event.kind === 'request.completed') {
      tags.push(`status:${event.status}`)
      if (event.status >= 400) tags.push('error')
      if (event.duration > 1000) tags.push('slow')
    }
    if (event.kind === 'request.failed') tags.push('error')

    // Redact sensitive headers (Authorization, Cookie, etc.)
    const content = { ...event }
    if (content.reqHeaders) {
      content.reqHeaders = redactHeaders(content.reqHeaders, hideList)
    }

    this.storage.store(createEntry('http', content, { tags }))
  }
}
```

Use the same `redactHeaders` helper from `src/redact.ts` with the config's `hideRequestHeaders` list.

### A.4 — Types + config + provider wiring

- `types.ts`: Add `'http'` to `EntryType` union
- `types.ts`: Add `recordHttp?: boolean | undefined` to `TelescopeConfig`, default `true`
- `index.ts`: Import `HttpCollector`, add to provider's collector list: `if (resolved.recordHttp) collectors.push(new HttpCollector(storage, resolved))`
- `index.ts`: Add re-export `export { HttpCollector } from './collectors/http.js'`
- `http/package.json`: Add `"./observers"` sub-export pointing to `./dist/observers.js`

### A.5 — UI: columns + detail view

**`columns.ts`** — add:
```ts
http: {
  type:  'http',
  title: 'HTTP Client',
  columns: [
    { label: 'Method', key: 'entry.content.method', badge: true },
    { label: 'URL',    key: 'entry.content.url',    mono: true, className: 'truncate max-w-md' },
    { label: 'Status', key: 'entry.content.status || "ERR"', badge: true },
    { label: 'Duration', key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
  ],
},
```

**`details/views.ts`** — add `HttpView`:
- Top card: Method (badge), URL (mono), Status (badge), Duration
- Request Headers card (KeyValueTable)
- Request Body card (JsonBlock, if present)
- Response Headers card (KeyValueTable)
- Response Body card (CodeBlock, truncated)
- Error card for failed requests (red text + message)

### A.6 — Tests

- `packages/http/src/observers.test.ts` — emit + subscribe + unsubscribe + error swallowing
- `packages/telescope/src/collectors/http.test.ts` — mock observer, verify entry shape + tags + redaction

---

## Phase B — GateCollector (~1.5h)

Records authorization decisions (`Gate.allows()`, `Gate.denies()`, `Gate.authorize()`).

### B.1 — Observer registry in `@rudderjs/auth`

**New file: `packages/auth/src/gate-observers.ts`**

```ts
export type GateEvent = {
  ability:   string
  userId:    string | number | null
  allowed:   boolean
  /** 'ability' | 'policy' | 'before' — what resolved the decision */
  resolvedVia: 'ability' | 'policy' | 'before' | 'default'
  /** Policy class name (if resolved via policy) */
  policy?:   string
  /** Model class name (if a model was passed) */
  model?:    string
  /** Duration of the check in ms */
  duration:  number
}

export type GateObserver = (event: GateEvent) => void

export class GateObserverRegistry {
  private observers: GateObserver[] = []
  subscribe(fn: GateObserver): () => void { ... }
  emit(event: GateEvent): void { ... }
  reset(): void { ... }
}

export const gateObservers: GateObserverRegistry
```

### B.2 — Hook point in `Gate._check()` and `Gate.allows()`

**File: `packages/auth/src/gate.ts`**

The central decision point is `Gate._check()` (line 82). Wrap it to capture the outcome:

1. In `Gate.allows()`: capture `start = performance.now()`, call `_check()`, capture `duration`, emit event with `allowed: result`.
2. Track `resolvedVia` by modifying `_check()` to return a richer result internally: `{ allowed: boolean, resolvedVia: string, policy?: string }`. The public API still returns `boolean`; the internal shape feeds the observer.
3. `GateForUser.allows()` gets the same treatment.

**Read `gateObservers` from globalThis** (same lazy pattern as http) — no circular dependency risk.

### B.3 — GateCollector in telescope

**New file: `packages/telescope/src/collectors/gate.ts`**

```ts
export class GateCollector implements Collector {
  readonly name = 'Gate Collector'
  readonly type = 'gate' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { gateObservers } = await import('@rudderjs/auth/gate-observers')
      gateObservers.subscribe((event) => this.record(event))
    } catch { /* @rudderjs/auth not installed */ }
  }

  private record(event: GateEvent): void {
    const tags: string[] = [
      event.allowed ? 'allowed' : 'denied',
      `via:${event.resolvedVia}`,
    ]
    if (event.policy) tags.push(`policy:${event.policy}`)
    if (event.duration > 50) tags.push('slow')

    this.storage.store(createEntry('gate', event, { tags }))
  }
}
```

### B.4 — Types + config + provider wiring

- `types.ts`: Add `'gate'` to `EntryType` union
- `types.ts`: Add `recordGate?: boolean | undefined` to `TelescopeConfig`, default `true`
- `index.ts`: Import + wire + re-export
- `auth/package.json`: Add `"./gate-observers"` sub-export

### B.5 — UI: columns + detail view

**`columns.ts`** — add:
```ts
gates: {
  type:  'gate',
  title: 'Gates',
  columns: [
    { label: 'Ability',  key: 'entry.content.ability', mono: true },
    { label: 'Result',   key: 'entry.content.allowed ? "Allowed" : "Denied"', badge: true },
    { label: 'Via',      key: 'entry.content.resolvedVia', badge: true },
    { label: 'Duration', key: '(entry.content.duration || 0) + "ms"', className: 'text-right' },
  ],
},
```

**`details/views.ts`** — add `GateView`:
- Top card: Ability (mono), Result (allowed/denied badge), Via (badge), Duration, User ID
- Policy card (if resolved via policy): policy name, model name
- Duration warning if > 50ms

### B.6 — Tests

- `packages/auth/src/gate-observers.test.ts` — registry basics
- `packages/telescope/src/collectors/gate.test.ts` — verify entry shape + tags

---

## Phase C — DumpCollector (~1h)

Records `dump()` and `dd()` calls with arguments and caller location.

### C.1 — Observer registry in `@rudderjs/support`

**New file: `packages/support/src/dump-observers.ts`**

```ts
export type DumpEvent = {
  args:      unknown[]
  /** 'dump' or 'dd' */
  method:    'dump' | 'dd'
  /** Caller file:line from Error().stack (best-effort) */
  caller?:   string
}

export type DumpObserver = (event: DumpEvent) => void

export class DumpObserverRegistry {
  private observers: DumpObserver[] = []
  subscribe(fn: DumpObserver): () => void { ... }
  emit(event: DumpEvent): void { ... }
  reset(): void { ... }
}

export const dumpObservers: DumpObserverRegistry
```

### C.2 — Hook point in `dump()` and `dd()`

**File: `packages/support/src/index.ts`** (lines 46-55)

```ts
export function dump(...args: unknown[]): void {
  // Emit to observer (if any subscriber is listening)
  const obs = getObs()
  if (obs) obs.emit({ args, method: 'dump', caller: getCaller() })

  for (const arg of args) {
    console.log(JSON.stringify(arg, null, 2))
  }
}

export function dd(...args: unknown[]): never {
  const obs = getObs()
  if (obs) obs.emit({ args, method: 'dd', caller: getCaller() })

  dump(...args)  // Note: dump will also emit, so guard against double-emit
  process.exit(1)
}
```

Wait — `dd` calls `dump` which would emit again. Fix: extract the observer emit into `dd` only, and have `dump` emit independently. Or: `dd` sets a flag to suppress the `dump` emit. Simpler: **`dd` emits its own event and calls the console.log directly instead of calling `dump`**:

```ts
export function dd(...args: unknown[]): never {
  const obs = getObs()
  if (obs) obs.emit({ args, method: 'dd', caller: getCaller() })
  for (const arg of args) console.log(JSON.stringify(arg, null, 2))
  process.exit(1)
}
```

**`getCaller()` helper** — parse `new Error().stack` to extract the caller's file:line (skip the first 2 frames: `getCaller` + `dump`/`dd`). Best-effort, returns `undefined` if parsing fails.

### C.3 — DumpCollector in telescope

**New file: `packages/telescope/src/collectors/dump.ts`**

```ts
export class DumpCollector implements Collector {
  readonly name = 'Dump Collector'
  readonly type = 'dump' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { dumpObservers } = await import('@rudderjs/support/dump-observers')
      dumpObservers.subscribe((event) => this.record(event))
    } catch { /* shouldn't fail — support is always installed */ }
  }

  private record(event: DumpEvent): void {
    const tags: string[] = [`method:${event.method}`]
    if (event.method === 'dd') tags.push('fatal')

    this.storage.store(createEntry('dump', {
      args:   event.args,
      method: event.method,
      caller: event.caller,
      count:  event.args.length,
    }, { tags }))
  }
}
```

### C.4 — Types + config + provider wiring

- `types.ts`: Add `'dump'` to `EntryType` union
- `types.ts`: Add `recordDumps?: boolean | undefined` to `TelescopeConfig`, default `true`
- `index.ts`: Import + wire + re-export
- `support/package.json`: Add `"./dump-observers"` sub-export

### C.5 — UI: columns + detail view

**`columns.ts`** — add:
```ts
dumps: {
  type:  'dump',
  title: 'Dumps',
  columns: [
    { label: 'Method', key: 'entry.content.method', badge: true },
    { label: 'Args',   key: 'entry.content.count + " value(s)"' },
    { label: 'Caller', key: 'entry.content.caller || "—"', mono: true, className: 'truncate max-w-md text-xs' },
  ],
},
```

**`details/views.ts`** — add `DumpView`:
- Top card: Method (badge — `dump` green, `dd` red), Caller (mono), Arg count
- One JsonBlock per argument (each in its own card: "Argument 1", "Argument 2", etc.)

### C.6 — Tests

- `packages/support/src/dump-observers.test.ts` — registry basics
- `packages/telescope/src/collectors/dump.test.ts` — verify entry shape + tags

---

## Cross-cutting changes

### Dashboard tab ordering

After all three land, the sidebar nav order in `Layout.ts` should be:

Dashboard | Requests | **HTTP Client** | Queries | Jobs | Commands | Exceptions | Logs | Mail | Notifications | Events | Cache | Schedule | Models | **Gates** | **Dumps** | WebSockets | Live (Yjs)

HTTP Client goes near Requests (both are HTTP). Gates goes near Models (both are auth/data). Dumps at the end before the real-time section.

### Sidebar nav in Layout.ts

The sidebar nav is generated from the `pages` map in `columns.ts`. Order in the map = order in the nav. Insert the new entries at the right positions.

---

## Sequencing

1. **Phase A** (HttpClient) — self-contained, touches only `@rudderjs/http` + telescope
2. **Phase B** (Gate) — touches `@rudderjs/auth` + telescope
3. **Phase C** (Dump) — touches `@rudderjs/support` + telescope

Each phase is one commit. No dependencies between them.

---

## Verification per phase

1. `pnpm build && pnpm typecheck` from root — all pass
2. `pnpm test` in the affected packages — all pass
3. `cd playground && pnpm dev` — navigate to `/telescope`, verify new tab appears, entries are collected
4. Detail page renders correctly for the new entry type

---

## Future (NOT in this plan)

- **WebSocket live push for all entry types** — broadcast every `storage.store()` call on a `telescope.entries` channel, telescope UI subscribes filtered by type. Benefits all 17 watchers, not just dumps. Separate plan.
- **HttpClient: global fetch interceptor** — today we only capture requests via `@rudderjs/http`. A global `fetch()` wrapper would capture requests from any library (axios, got, raw fetch). More invasive, separate effort.

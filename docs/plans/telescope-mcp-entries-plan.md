# Telescope MCP Entries Plan

Add MCP server monitoring to `@rudderjs/telescope` — tool calls, resource reads, and prompt renders from `@rudderjs/mcp` servers appear in the Telescope dashboard alongside existing AI, request, query, and other entry types.

**Status:** Not started

**Packages affected:**
- `@rudderjs/mcp` — add `mcpObservers` observer registry (new `src/observers.ts` + subpath export)
- `@rudderjs/telescope` — add `McpCollector` + UI views

**Breaking change risk:** None. All additive. Observer emission is no-op when no subscribers.

**Depends on:** Nothing — `@rudderjs/mcp` and `@rudderjs/telescope` both exist and are stable.

---

## Goal

After this plan:

1. Every MCP tool call, resource read, and prompt render emits a structured event via an `mcpObservers` globalThis registry (same pattern as `aiObservers`, `httpObservers`).
2. Telescope's `McpCollector` subscribes and records entries with duration, input, output, error, and tags.
3. The Telescope dashboard has an **MCP** tab showing all MCP operations — list view with server/type/name/duration columns, detail view with input/output/error cards.

---

## Non-Goals

- **MCP client monitoring.** This is for `@rudderjs/mcp` servers (tools you build), not MCP clients (tools you consume via `@rudderjs/boost`).
- **Session lifecycle tracking.** HTTP session init/close could be added later but isn't needed for v1.
- **List operations.** `ListTools`, `ListResources`, `ListPrompts` are metadata-only — not worth recording.

---

## Phase 1 — MCP Observer Registry (`@rudderjs/mcp`)

**What:** A globalThis observer registry in `@rudderjs/mcp` that emits events when tools, resources, and prompts are invoked. Same architecture as `@rudderjs/ai/observers`.

### 1.1 — Create `packages/mcp/src/observers.ts`

```ts
export interface McpObserverEvent {
  kind:       'tool.called' | 'tool.failed' | 'resource.read' | 'resource.failed' | 'prompt.rendered' | 'prompt.failed'
  serverName: string
  name:       string        // tool/resource/prompt name
  input:      unknown       // args, URI params, or prompt args
  output:     unknown       // result, content, or messages (null on failure)
  duration:   number        // ms
  error?:     string        // present on *.failed events
}

export type McpObserver = (event: McpObserverEvent) => void

export class McpObserverRegistry {
  private observers: McpObserver[] = []

  subscribe(fn: McpObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  emit(event: McpObserverEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break MCP servers */ }
    }
  }

  reset(): void { this.observers = [] }
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_mcp_observers__']) {
  _g['__rudderjs_mcp_observers__'] = new McpObserverRegistry()
}
export const mcpObservers = _g['__rudderjs_mcp_observers__'] as McpObserverRegistry
```

### 1.2 — Add subpath export to `packages/mcp/package.json`

```json
"./observers": {
  "import": "./dist/observers.js",
  "types": "./dist/observers.d.ts"
}
```

### 1.3 — Wire emissions into `packages/mcp/src/runtime.ts`

Add a lazy accessor at the top of `runtime.ts` (same pattern as `@rudderjs/ai/src/agent.ts`):

```ts
let _mcpObs: McpObserverRegistry | null | undefined
function _getMcpObservers(): McpObserverRegistry | null {
  if (_mcpObs === undefined) {
    _mcpObs = (globalThis as Record<string, unknown>)['__rudderjs_mcp_observers__'] as McpObserverRegistry | undefined ?? null
  }
  return _mcpObs
}
```

Then wrap the three handlers in `createSdkServer()`:

**Tool call handler** (lines 90-102):
```ts
sdk.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name() === request.params.name)
  if (!tool) {
    return { content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }], isError: true }
  }
  const start = performance.now()
  try {
    const result = await tool.handle((request.params.arguments ?? {}) as Record<string, unknown>)
    _getMcpObservers()?.emit({
      kind: 'tool.called', serverName: meta.name, name: tool.name(),
      input: request.params.arguments ?? {}, output: result, duration: performance.now() - start,
    })
    return { ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    _getMcpObservers()?.emit({
      kind: 'tool.failed', serverName: meta.name, name: tool.name(),
      input: request.params.arguments ?? {}, output: null, duration: performance.now() - start, error: msg,
    })
    return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
  }
})
```

**Resource read handler** (lines 128-157) — same pattern: wrap `resource.handle(params)` with timing + emit `resource.read` / `resource.failed`.

**Prompt render handler** (lines 168-174) — same pattern: wrap `prompt.handle(args)` with timing + emit `prompt.rendered` / `prompt.failed`.

### 1.4 — Export from `packages/mcp/src/index.ts`

Re-export observer types (not the registry instance):

```ts
export type { McpObserverEvent, McpObserver, McpObserverRegistry } from './observers.js'
```

---

## Phase 2 — Telescope McpCollector (`@rudderjs/telescope`)

### 2.1 — Add `'mcp'` to `EntryType` in `src/types.ts`

```ts
export type EntryType =
  | 'request' | 'query' | 'job' | 'exception' | 'log'
  | 'mail' | 'notification' | 'event' | 'cache' | 'schedule'
  | 'model' | 'command' | 'broadcast' | 'live' | 'http'
  | 'gate' | 'dump' | 'ai'
  | 'mcp'  // ← add
```

### 2.2 — Add config options to `TelescopeConfig`

```ts
recordMcp?:           boolean | undefined    // default true
slowMcpThreshold?:    number | undefined     // default 1000 (ms)
```

### 2.3 — Create `src/collectors/mcp.ts`

Follow `AiCollector` pattern exactly:

```ts
import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

export class McpCollector implements Collector {
  readonly name = 'MCP Collector'
  readonly type = 'mcp' as const

  constructor(
    private readonly storage: TelescopeStorage,
    private readonly config:  TelescopeConfig,
  ) {}

  async register(): Promise<void> {
    try {
      const mod = await import('@rudderjs/mcp/observers') as unknown as {
        mcpObservers: { subscribe(fn: (event: McpEvent) => void): () => void }
      }
      const { mcpObservers } = mod

      const storage   = this.storage
      const threshold = this.config.slowMcpThreshold ?? 1000

      mcpObservers.subscribe((event: McpEvent) => {
        const tags: string[] = [
          `server:${event.serverName}`,
          `type:${event.kind.split('.')[0]}`,  // tool, resource, prompt
          `name:${event.name}`,
        ]
        if (event.kind.endsWith('.failed')) tags.push('error')
        if (event.duration > threshold)     tags.push('slow')

        storage.store(createEntry('mcp', {
          kind:       event.kind,
          serverName: event.serverName,
          name:       event.name,
          input:      event.input,
          output:     event.output,
          duration:   event.duration,
          error:      event.error,
        }, { tags, ...batchOpts() }))
      })
    } catch {
      // @rudderjs/mcp not installed — skip
    }
  }
}

// Local event shape (no runtime import)
interface McpEvent {
  kind:       'tool.called' | 'tool.failed' | 'resource.read' | 'resource.failed' | 'prompt.rendered' | 'prompt.failed'
  serverName: string
  name:       string
  input:      unknown
  output:     unknown
  duration:   number
  error?:     string
}
```

### 2.4 — Register collector in `src/index.ts`

In the provider boot section, add:

```ts
if (resolved.recordMcp) {
  collectors.push(new McpCollector(storage, resolved))
}
```

Export the collector:

```ts
export { McpCollector } from './collectors/mcp.js'
```

---

## Phase 3 — Telescope UI

### 3.1 — List view columns (`src/views/vanilla/columns.ts`)

Add `mcp` page config:

```ts
mcp: {
  type:  'mcp',
  title: 'MCP',
  columns: [
    { label: 'Server',   key: 'entry.content.serverName',   badge: true },
    { label: 'Type',     key: "entry.content.kind.split('.')[0]", badge: true },
    { label: 'Name',     key: 'entry.content.name',         mono: true },
    { label: 'Duration', key: "entry.content.duration != null ? Math.round(entry.content.duration) + 'ms' : '—'", className: 'text-right' },
    { label: 'Status',   key: "entry.content.error ? 'Failed' : 'OK'", badge: true },
  ],
},
```

### 3.2 — Detail view (`src/views/vanilla/details/views.ts`)

Add `McpView`:

```ts
const McpView: ViewFn = (entry) => {
  const c = entry.content as Record<string, unknown>
  const kind = String(c['kind'] ?? '')
  const type = kind.split('.')[0]  // tool, resource, prompt

  return html`
    ${Card('MCP Operation', KeyValueTable({
      Server:   c['serverName'],
      Type:     Badge(type),
      Name:     raw(`<span class="font-mono text-xs">${escape(String(c['name'] ?? ''))}</span>`),
      Duration: c['duration'] != null ? `${Math.round(c['duration'] as number)}ms` : '—',
      Status:   c['error'] ? Badge('Failed', 'red') : Badge('OK', 'green'),
    }))}

    ${c['input'] !== undefined && c['input'] !== null
      ? Card('Input', JsonBlock(c['input']))
      : ''}

    ${c['output'] !== undefined && c['output'] !== null && !c['error']
      ? Card('Output', JsonBlock(c['output']))
      : ''}

    ${c['error']
      ? Card('Error', CodeBlock(String(c['error'])))
      : ''}
  `
}
```

Register in `detailViews`:
```ts
mcp: McpView,
```

### 3.3 — Route registration (`src/routes.ts`)

Add `'mcp'` to `ENTRY_TYPES` array so API and page routes are auto-generated.

### 3.4 — Dashboard card (`src/views/vanilla/dashboard.ts`)

Add MCP to the dashboard grid (icon: plug or terminal):

```ts
{ type: 'mcp', label: 'MCP', icon: '⚡' },
```

### 3.5 — Sidebar nav

Add MCP link to the sidebar navigation, positioned after AI.

---

## Phase Order

| Phase | Description | Package | Depends on |
|---|---|---|---|
| 1 | MCP observer registry + wire into runtime | `@rudderjs/mcp` | — |
| 2 | McpCollector + config + exports | `@rudderjs/telescope` | Phase 1 |
| 3 | UI (list, detail, dashboard, sidebar, routes) | `@rudderjs/telescope` | Phase 2 |

Phases 1 → 2 → 3 are sequential. Each phase is independently testable.

---

## Verification Checklist

- [ ] `@rudderjs/mcp` builds clean with observer emissions
- [ ] Observers are no-op when no subscribers (standalone usage)
- [ ] Observer errors don't break MCP tool execution (try/catch in emit)
- [ ] `@rudderjs/telescope` builds clean with new collector
- [ ] MCP tab shows in Telescope dashboard when `recordMcp: true` (default)
- [ ] MCP tab does not appear when `@rudderjs/mcp` is not installed
- [ ] Tool calls show with name, input args, output, duration
- [ ] Resource reads show with URI, content, duration
- [ ] Prompt renders show with name, args, messages, duration
- [ ] Failed operations show error in detail view
- [ ] Slow operations are tagged `slow` (threshold configurable)
- [ ] `pnpm typecheck` clean in both packages
- [ ] Playground can display MCP entries after a tool call

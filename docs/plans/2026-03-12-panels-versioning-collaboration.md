# Panels Live Table + Versioning + Collaboration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three independent, composable real-time features to `@boostkit/panels`:

1. **`static live = true`** — Live table updates via `@boostkit/broadcast` (WebSocket). No Yjs.
2. **`static versioned = true`** — Yjs-backed version history, drafts, snapshots per record.
3. **`.collaborative()`** — Per-field real-time live editing via Yjs (requires `versioned`).

**Architecture:**
- `live` is lightweight: broadcast CRUD mutations → table auto-refreshes. Uses existing `@boostkit/broadcast`.
- `versioned` is heavy: each record gets a ydoc (`panel:{slug}:{id}`). DB = published state, ydoc = draft + history. Save = snapshot + publish.
- `collaborative` builds on `versioned`: syncs specific field values in `ydoc.getMap('fields')` via `y-websocket` between editors.

**Tech Stack:** `@boostkit/broadcast` (live), `@boostkit/live` + Yjs + y-websocket (versioned + collaborative), Prisma, React

---

## Glossary

| Term | Meaning |
|---|---|
| live | `static live = true` — table auto-updates when records change. Uses `@boostkit/broadcast`. No Yjs. |
| versioned | `static versioned = true` — Yjs ydoc per record for version history + drafts |
| collaborative | `.collaborative()` on a Field — real-time live editing between users via Yjs |
| docName | Unique ydoc identifier: `panel:{resourceSlug}:{recordId}` |
| snapshot | `Uint8Array` from `Y.encodeStateAsUpdate(doc)` — full doc state at a point in time |

---

## Feature Matrix

```ts
// Just live table — lightweight, no Yjs
export class TodoResource extends Resource {
  static live = true
}

// Version history + drafts — no real-time editing
export class PolicyResource extends Resource {
  static versioned = true
}

// Full combo — live table + versions + per-field collaboration
export class ArticleResource extends Resource {
  static live      = true
  static versioned = true

  fields() {
    return [
      TextField.make('title').collaborative(),  // live-synced between editors
      TextareaField.make('body').collaborative(),
      SelectField.make('status'),               // normal (still versioned, not live-synced)
    ]
  }
}
```

---

## Task 1: `static live = true` — Broadcast on CRUD mutations

**Files:**
- Modify: `packages/panels/src/PanelServiceProvider.ts`
- Modify: `packages/panels/src/Resource.ts`
- Modify: `packages/panels/src/Resource.ts` (ResourceMeta)

### Why

This is the simplest feature — when a record is created/updated/deleted, broadcast to all connected clients viewing that resource's table. The table page listens and refetches. No Yjs, no ydoc — just the existing `@boostkit/broadcast` infrastructure.

**Step 1: Add `static live = false` to Resource class**

In `packages/panels/src/Resource.ts`, after `static paginationType` (~line 77):

```ts
/**
 * Enable live table updates via WebSocket broadcasting.
 * When true, any CRUD mutation broadcasts to all connected viewers,
 * causing their table to refresh automatically.
 * Uses @boostkit/broadcast — no Yjs required.
 */
static live = false
```

**Step 2: Add `live` to `ResourceMeta` interface**

```ts
live: boolean
```

**Step 3: Add to `toMeta()` method**

```ts
live: Cls.live,
```

**Step 4: Broadcast after CRUD mutations in `PanelServiceProvider`**

In `mountResource()`, after each successful mutation, broadcast to the resource channel. The broadcast import is dynamic (lazy) so there's zero overhead when `@boostkit/broadcast` isn't registered.

After the `create` handler's `return res.status(201).json(...)` (~line 387), add:

```ts
// Live broadcast — notify all viewers
if ((ResourceClass as any).live) {
  try {
    const { broadcast } = await import('@boostkit/broadcast')
    broadcast(`panel:${slug}`, 'record.created', { id: record.id })
  } catch { /* broadcast not registered */ }
}
```

Same pattern after `update` (~line 408):

```ts
if ((ResourceClass as any).live) {
  try {
    const { broadcast } = await import('@boostkit/broadcast')
    broadcast(`panel:${slug}`, 'record.updated', { id })
  } catch {}
}
```

After `delete` (~line 423):

```ts
if ((ResourceClass as any).live) {
  try {
    const { broadcast } = await import('@boostkit/broadcast')
    broadcast(`panel:${slug}`, 'record.deleted', { id })
  } catch {}
}
```

After `bulk delete` (~line 445):

```ts
if ((ResourceClass as any).live) {
  try {
    const { broadcast } = await import('@boostkit/broadcast')
    broadcast(`panel:${slug}`, 'records.deleted', { ids, deleted })
  } catch {}
}
```

After `bulk action` (~line 471):

```ts
if ((ResourceClass as any).live) {
  try {
    const { broadcast } = await import('@boostkit/broadcast')
    broadcast(`panel:${slug}`, 'action.executed', { action: actionName, ids })
  } catch {}
}
```

**Step 5: Build and verify**

Run: `cd packages/panels && pnpm build`

**Step 6: Commit**

```bash
git add packages/panels/src/Resource.ts packages/panels/src/PanelServiceProvider.ts
git commit -m "feat(panels): add static live flag + broadcast on CRUD mutations"
```

---

## Task 2: Live table auto-refresh hook — `useLiveTable`

**Files:**
- Create: `packages/panels/pages/_hooks/useLiveTable.ts`
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`

### Why

The table page needs to listen for broadcast events and re-navigate (refetch SSR data) when records change. This hook encapsulates the WebSocket subscription.

**Step 1: Create the hook**

```ts
import { useEffect, useRef } from 'react'
import { navigate } from 'vike/client/router'

/**
 * Subscribe to live table updates for a resource.
 * On any CRUD broadcast, triggers a Vike re-navigation to refetch SSR data.
 * Uses BKSocket from @boostkit/broadcast (published to src/).
 */
export function useLiveTable(options: {
  enabled:      boolean
  slug:         string
  pathSegment:  string
}) {
  const socketRef = useRef<any>(null)

  useEffect(() => {
    if (!options.enabled || typeof window === 'undefined') return

    let destroyed = false

    async function connect() {
      // Dynamic import — BKSocket is a published client file
      // Try multiple import paths for flexibility
      let BKSocket: any
      try {
        BKSocket = (await import('@/BKSocket')).BKSocket
      } catch {
        try {
          BKSocket = (await import('../../../../../../src/BKSocket.js')).BKSocket
        } catch {
          return // BKSocket not available — silently skip
        }
      }

      if (destroyed) return

      const wsUrl = `ws://${window.location.host}/ws`
      const socket = new BKSocket(wsUrl)
      socketRef.current = socket

      const channel = socket.channel(`panel:${options.slug}`)

      // On any record mutation, refetch the current page data
      const refetch = () => {
        void navigate(window.location.pathname + window.location.search, {
          overwriteLastHistoryEntry: true,
        })
      }

      channel.on('record.created',   refetch)
      channel.on('record.updated',   refetch)
      channel.on('record.deleted',   refetch)
      channel.on('records.deleted',  refetch)
      channel.on('action.executed',  refetch)
    }

    void connect()

    return () => {
      destroyed = true
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [options.enabled, options.slug, options.pathSegment])
}
```

**Step 2: Wire into the table page**

In `packages/panels/pages/@panel/@resource/+Page.tsx`, at the top, import:

```ts
import { useLiveTable } from '../../_hooks/useLiveTable.js'
```

Inside `ResourceListPage()`, after the existing state declarations (~line 63), add:

```ts
// ── Live table auto-refresh ──────────────────────
useLiveTable({
  enabled:     resourceMeta.live,
  slug,
  pathSegment,
})
```

**Step 3: Build and verify**

Run: `cd packages/panels && pnpm build`

**Step 4: Commit**

```bash
git add packages/panels/pages/_hooks/useLiveTable.ts packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add useLiveTable hook for live table auto-refresh"
```

---

## Task 3: Improve `@boostkit/live` — `Live` facade + DI + async fix

**Files:**
- Modify: `packages/live/src/index.ts`

### Why

The current `@boostkit/live` has no programmatic API — persistence is trapped inside the `live()` factory closure, and `getOrCreateRoom()` is private. Without improvements, panels code would need ugly `globalThis` hacks. This adds a `Live` facade (mirroring `Broadcast` facade pattern) for clean panels integration.

### Problems fixed

1. **No `Live` facade** — Add `Live.seed()`, `Live.snapshot()`, `Live.readMap()`, `Live.persistence()`
2. **Async race in `getOrCreateRoom`** — `persistence.getYDoc().then(...)` fire-and-forgets. Add `ready` promise to Room.
3. **`livePrisma` creates new PrismaClient per call** — Accept existing client via config, cache internally.
4. **No DI integration** — Bind persistence as `'live.persistence'` in the container.

**Step 1: Add `ready` promise to Room and fix `getOrCreateRoom`**

```ts
interface Room {
  doc:     Y.Doc
  clients: Set<import('ws').WebSocket>
  ready:   Promise<void>
}

function getOrCreateRoom(docName: string, persistence: LivePersistence): Room {
  const rooms = g[KEY] as Map<string, Room> ?? new Map<string, Room>()
  g[KEY] = rooms
  if (!rooms.has(docName)) {
    const doc = new Y.Doc()
    const ready = persistence.getYDoc(docName).then(persisted => {
      const sv     = Y.encodeStateVector(doc)
      const update = Y.encodeStateAsUpdate(persisted, sv)
      if (update.length > 2) Y.applyUpdate(doc, update)
    }).catch(() => {})
    rooms.set(docName, { doc, clients: new Set(), ready })
  }
  return rooms.get(docName)!
}
```

**Step 2: Store persistence on globalThis + bind to DI**

In `live()` factory's `boot()`, add:

```ts
g['__boostkit_live_persistence__'] = persistence
```

In `register()`:

```ts
register(): void {
  this.app.bind('live.persistence', persistence)
}
```

**Step 3: Add the `Live` facade**

After the `live()` factory:

```ts
/**
 * Live facade — programmatic access to Yjs documents from server-side code.
 * Mirrors @boostkit/broadcast's `Broadcast` facade pattern.
 *
 * @example
 * import { Live } from '@boostkit/live'
 *
 * await Live.seed('panel:articles:42', { title: 'Hello', body: '' })
 * const snapshot = Live.snapshot('panel:articles:42')
 * const fields   = Live.readMap('panel:articles:42', 'fields')
 */
export const Live = {
  /** Get the configured persistence adapter. */
  persistence(): LivePersistence {
    const p = g['__boostkit_live_persistence__'] as LivePersistence | undefined
    if (!p) throw new Error('[Live] Not initialised — register live() in providers.')
    return p
  },

  /**
   * Seed a ydoc with initial data (e.g. from a DB record).
   * Safe to call multiple times — only seeds when the ydoc is empty.
   */
  async seed(docName: string, data: Record<string, unknown>): Promise<void> {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    await room.ready

    const sv = Y.encodeStateVector(room.doc)
    if (sv.length > 1) return

    const fields = room.doc.getMap('fields')
    room.doc.transact(() => {
      for (const [key, val] of Object.entries(data)) {
        fields.set(key, val ?? null)
      }
    })
  },

  /**
   * Return the current full state of a ydoc as a snapshot (Uint8Array).
   * Purely a read operation — does not modify persistence.
   */
  snapshot(docName: string): Uint8Array {
    const persistence = this.persistence()
    const room = getOrCreateRoom(docName, persistence)
    return Y.encodeStateAsUpdate(room.doc)
  },

  /**
   * Read a Y.Map from a ydoc as a plain JS object.
   */
  readMap(docName: string, mapName: string): Record<string, unknown> {
    const persistence = this.persistence()
    const room   = getOrCreateRoom(docName, persistence)
    const ymap   = room.doc.getMap(mapName)
    const result: Record<string, unknown> = {}
    ymap.forEach((val, key) => { result[key] = val })
    return result
  },
}
```

**Step 4: Improve `livePrisma` — accept existing PrismaClient**

```ts
export interface PrismaPersistenceConfig {
  model?:  string
  /** Pass an existing PrismaClient to avoid creating a new one per operation. */
  client?: unknown
}

export function livePrisma(config: PrismaPersistenceConfig = {}): LivePersistence {
  const modelName = config.model ?? 'liveDocument'
  let cachedClient: unknown = config.client ?? null

  async function getClient() {
    if (cachedClient) return cachedClient
    const { PrismaClient } = await import('@prisma/client') as any
    cachedClient = new PrismaClient()
    return cachedClient
  }

  return {
    async getYDoc(docName: string): Promise<Y.Doc> {
      const prisma = await getClient() as any
      const doc    = new Y.Doc()
      const rows   = await prisma[modelName].findMany({ where: { docName } })
      for (const row of rows) Y.applyUpdate(doc, row.update)
      return doc
    },

    async storeUpdate(docName: string, update: Uint8Array): Promise<void> {
      const prisma = await getClient() as any
      await prisma[modelName].create({ data: { docName, update } })
    },

    async getStateVector(docName: string): Promise<Uint8Array> {
      const doc = await this.getYDoc(docName)
      return Y.encodeStateVector(doc)
    },

    async getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array> {
      const doc = await this.getYDoc(docName)
      return Y.encodeStateAsUpdate(doc, stateVector)
    },

    async clearDocument(docName: string): Promise<void> {
      const prisma = await getClient() as any
      await prisma[modelName].deleteMany({ where: { docName } })
    },

    async destroy(): Promise<void> {
      if (!config.client && cachedClient) {
        await (cachedClient as any).$disconnect?.()
      }
    },
  }
}
```

**Step 5: Build and verify**

Run: `cd packages/live && pnpm build`

**Step 6: Commit**

```bash
git add packages/live/src/index.ts
git commit -m "feat(live): add Live facade, DI binding, fix async race, improve livePrisma"
```

---

## Task 4: Add `.collaborative()` to Field and `collaborative` to FieldMeta

**Files:**
- Modify: `packages/panels/src/Field.ts`

**Step 1: Add `_collaborative` property**

After `protected _displayFn?:` (~line 52):

```ts
protected _collaborative = false
```

**Step 2: Add `.collaborative()` fluent method**

After `display()` (~line 253):

```ts
/**
 * Enable real-time collaborative editing for this field.
 * Value syncs live via Yjs between all connected editors.
 * Requires `static versioned = true` on the resource.
 */
collaborative(value = true): this {
  this._collaborative = value
  return this
}

/** @internal */
isCollaborative(): boolean { return this._collaborative }
```

**Step 3: Add `collaborative` to FieldMeta interface**

```ts
collaborative?: boolean
```

**Step 4: Serialize in `toMeta()`**

After `displayTransformed`:

```ts
if (this._collaborative) meta.collaborative = true
```

**Step 5: Build and verify**

Run: `cd packages/panels && pnpm build`

**Step 6: Commit**

```bash
git add packages/panels/src/Field.ts
git commit -m "feat(panels): add .collaborative() fluent method to Field"
```

---

## Task 5: Add `static versioned` to Resource and ResourceMeta

**Files:**
- Modify: `packages/panels/src/Resource.ts`

**Step 1: Add `versioned` static property**

After `static live`:

```ts
/**
 * Enable Yjs-backed version history for this resource.
 * Each record gets a ydoc that tracks field changes over time.
 * Save = snapshot ydoc + publish field values to DB.
 * Uses @boostkit/live.
 */
static versioned = false
```

**Step 2: Add to ResourceMeta**

```ts
versioned: boolean
```

**Step 3: Add to toMeta()**

```ts
versioned: Cls.versioned,
```

**Step 4: Build and verify**

Run: `cd packages/panels && pnpm build`

**Step 5: Commit**

```bash
git add packages/panels/src/Resource.ts
git commit -m "feat(panels): add static versioned flag to Resource"
```

---

## Task 6: Add `PanelVersion` Prisma model to playground

**Files:**
- Modify: `playground/prisma/schema.prisma`

**Step 1: Add the model**

```prisma
model PanelVersion {
  id          String   @id @default(cuid())
  docName     String   // panel:{resourceSlug}:{recordId}
  snapshot    Bytes    // Y.encodeStateAsUpdate(doc)
  label       String?  // optional user-provided label
  userId      String?  // who saved this version
  createdAt   DateTime @default(now())

  @@index([docName, createdAt])
}
```

**Step 2: Push to DB**

Run: `cd playground && pnpm exec prisma db push`

**Step 3: Commit**

```bash
git add playground/prisma/schema.prisma
git commit -m "feat(playground): add PanelVersion Prisma model for version history"
```

---

## Task 7: Version history API routes in PanelServiceProvider

**Files:**
- Modify: `packages/panels/src/PanelServiceProvider.ts`

Three routes per versioned resource:

1. `GET  /{panel}/api/{resource}/{id}/_versions` — list
2. `POST /{panel}/api/{resource}/{id}/_versions` — create (snapshot + publish)
3. `GET  /{panel}/api/{resource}/{id}/_versions/{versionId}` — detail

**Step 1: Gate on `ResourceClass.versioned` in `mountResource()`**

After bulk action route (~line 472):

```ts
if ((ResourceClass as any).versioned) {
  this.mountVersionRoutes(router, panel, ResourceClass, mw)
}
```

**Step 2: Add `mountVersionRoutes` private method**

Uses `Live` facade — clean, no `globalThis` hacks:

```ts
private mountVersionRoutes(
  router: { get: Function; post: Function; put: Function; delete: Function },
  panel: Panel,
  ResourceClass: typeof Resource,
  mw: MiddlewareHandler[],
): void {
  const slug = ResourceClass.getSlug()
  const base = `${panel.getApiBase()}/${slug}`

  // List versions
  router.get(`${base}/:id/_versions`, async (req: AppRequest, res: AppResponse) => {
    const id = (req.params as Record<string, string>)['id']
    const docName = `panel:${slug}:${id}`
    try {
      const prisma = this.app.make<any>('prisma')
      const versions = await prisma.panelVersion.findMany({
        where: { docName },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, userId: true, createdAt: true },
      })
      return res.json({ data: versions })
    } catch {
      return res.json({ data: [] })
    }
  }, mw)

  // Create version (snapshot + publish)
  router.post(`${base}/:id/_versions`, async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx = this.buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const Model = ResourceClass.model as any
    if (!Model) return res.status(500).json({ message: 'No model.' })

    const id      = (req.params as Record<string, string>)['id']
    const docName = `panel:${slug}:${id}`
    const body    = req.body as { label?: string }

    try {
      const { Live } = await import('@boostkit/live')
      const prisma   = this.app.make<any>('prisma')

      const snapshot    = Live.snapshot(docName)
      const fieldValues = Live.readMap(docName, 'fields')

      await prisma.panelVersion.create({
        data: {
          docName,
          snapshot: Buffer.from(snapshot),
          label:    body.label ?? null,
          userId:   (ctx.user as any)?.id ?? null,
        },
      })

      const coerced = this.coercePayload(resource, fieldValues, 'update')
      await Model.query().update(id, coerced)

      // Also broadcast if live is enabled
      if ((ResourceClass as any).live) {
        try {
          const { broadcast } = await import('@boostkit/broadcast')
          broadcast(`panel:${slug}`, 'record.updated', { id })
        } catch {}
      }

      return res.json({ message: 'Version saved and published.' })
    } catch (err) {
      return res.status(500).json({ message: 'Failed to save version.', error: String(err) })
    }
  }, mw)

  // Get version detail
  router.get(`${base}/:id/_versions/:versionId`, async (req: AppRequest, res: AppResponse) => {
    const versionId = (req.params as Record<string, string>)['versionId']
    try {
      const prisma  = this.app.make<any>('prisma')
      const version = await prisma.panelVersion.findUnique({ where: { id: versionId } })
      if (!version) return res.status(404).json({ message: 'Version not found.' })

      const Y   = await import('yjs')
      const doc = new Y.Doc()
      Y.applyUpdate(doc, new Uint8Array(version.snapshot))
      const fields = doc.getMap('fields')
      const data: Record<string, unknown> = {}
      fields.forEach((val: unknown, key: string) => { data[key] = val })
      doc.destroy()

      return res.json({
        data: {
          id:        version.id,
          label:     version.label,
          userId:    version.userId,
          createdAt: version.createdAt,
          fields:    data,
        },
      })
    } catch (err) {
      return res.status(500).json({ message: 'Failed to read version.', error: String(err) })
    }
  }, mw)
}
```

**Step 3: Build**

Run: `cd packages/panels && pnpm build`

**Step 4: Commit**

```bash
git add packages/panels/src/PanelServiceProvider.ts
git commit -m "feat(panels): add version history API routes for versioned resources"
```

---

## Task 8: Seed ydoc on edit page load

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/@id/edit/+data.ts`

**Step 1: After fetching record, seed ydoc if versioned**

After `record = await q.find(id)` (~line 47):

```ts
if (record && (ResourceClass as any).versioned) {
  try {
    const { Live } = await import('@boostkit/live')
    const docName = `panel:${slug}:${id}`
    const fieldData: Record<string, unknown> = {}
    for (const f of flattenFields(resource.fields())) {
      const name = (f as any).getName() as string
      if (name in (record as any)) {
        fieldData[name] = (record as any)[name]
      }
    }
    await Live.seed(docName, fieldData)
  } catch {
    // @boostkit/live not available
  }
}
```

**Step 2: Pass versioning flags to frontend**

Add to return object:

```ts
versioned:  (ResourceClass as any).versioned ?? false,
wsLivePath: (ResourceClass as any).versioned ? '/ws-live' : null,
docName:    (ResourceClass as any).versioned ? `panel:${slug}:${id}` : null,
```

**Step 3: Build and commit**

```bash
cd packages/panels && pnpm build
git add packages/panels/pages/@panel/@resource/@id/edit/+data.ts
git commit -m "feat(panels): seed ydoc on versioned resource edit page load"
```

---

## Task 9: `useCollaborativeForm` hook

**Files:**
- Create: `packages/panels/pages/_hooks/useCollaborativeForm.ts`

Connects to ydoc via `y-websocket`, syncs collaborative fields bidirectionally with React form state, provides presence.

**Step 1: Create the hook**

```ts
import { useEffect, useRef, useState, useCallback } from 'react'

interface CollaborativeFormOptions {
  docName:  string
  wsPath:   string
  fields:   { name: string; collaborative?: boolean }[]
  values:   Record<string, unknown>
  setValue:  (name: string, value: unknown) => void
}

interface Presence { name: string; color: string }

export function useCollaborativeForm(options: CollaborativeFormOptions | null) {
  const [connected, setConnected] = useState(false)
  const [presences, setPresences] = useState<Presence[]>([])
  const providerRef = useRef<any>(null)
  const docRef      = useRef<any>(null)
  const suppressRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!options) return
    let destroyed = false

    async function connect() {
      const Y = await import('yjs')
      const { WebsocketProvider } = await import('y-websocket')
      if (destroyed) return

      const wsUrl    = `ws://${window.location.host}${options!.wsPath}`
      const doc      = new Y.Doc()
      const provider = new WebsocketProvider(wsUrl, options!.docName, doc)

      docRef.current      = doc
      providerRef.current = provider

      const fieldsMap = doc.getMap('fields')

      fieldsMap.observe((event) => {
        event.keysChanged.forEach((key) => {
          if (suppressRef.current.has(key)) { suppressRef.current.delete(key); return }
          const field = options!.fields.find(f => f.name === key)
          if (field?.collaborative) options!.setValue(key, fieldsMap.get(key))
        })
      })

      provider.on('status', ({ status }: { status: string }) => {
        setConnected(status === 'connected')
      })

      const userName  = `User-${Math.floor(Math.random() * 1000)}`
      const userColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`
      provider.awareness.setLocalStateField('user', { name: userName, color: userColor })

      const syncPresences = () => {
        const states = [...provider.awareness.getStates().values()] as { user?: Presence }[]
        setPresences(states.flatMap(s => s.user ? [s.user] : []))
      }
      syncPresences()
      provider.awareness.on('change', syncPresences)

      const collabFields = options!.fields.filter(f => f.collaborative)
      doc.transact(() => {
        for (const f of collabFields) {
          if (!fieldsMap.has(f.name)) fieldsMap.set(f.name, options!.values[f.name] ?? null)
        }
      })
    }

    void connect()
    return () => {
      destroyed = true
      providerRef.current?.destroy()
      docRef.current?.destroy()
      providerRef.current = null
      docRef.current      = null
    }
  }, [options?.docName])

  const setCollaborativeValue = useCallback((name: string, value: unknown) => {
    const doc = docRef.current
    if (!doc) return
    suppressRef.current.add(name)
    doc.getMap('fields').set(name, value ?? null)
  }, [])

  const syncAllFieldsToDoc = useCallback((allValues: Record<string, unknown>) => {
    const doc = docRef.current
    if (!doc) return
    const fieldsMap = doc.getMap('fields')
    doc.transact(() => {
      for (const [key, val] of Object.entries(allValues)) fieldsMap.set(key, val ?? null)
    })
  }, [])

  return { connected, presences, setCollaborativeValue, syncAllFieldsToDoc }
}
```

**Step 2: Build and commit**

```bash
cd packages/panels && pnpm build
git add packages/panels/pages/_hooks/useCollaborativeForm.ts
git commit -m "feat(panels): add useCollaborativeForm hook for live field sync"
```

---

## Task 10: Wire collaborative form + version history into edit page

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx`
- Modify: `packages/panels/src/i18n/en.ts`
- Modify: `packages/panels/src/i18n/ar.ts`

**Step 1: Import hooks**

```ts
import { useCollaborativeForm } from '../../../../_hooks/useCollaborativeForm.js'
```

**Step 2: Initialize collaborative hook**

After `useState` declarations:

```ts
const { versioned, wsLivePath, docName } = useData<Data>()

const collaborativeFields = formFields.filter(f => f.collaborative)
const hasCollaboration = versioned && collaborativeFields.length > 0 && docName

const collab = useCollaborativeForm(
  hasCollaboration ? {
    docName:  docName!,
    wsPath:   wsLivePath!,
    fields:   formFields.map(f => ({ name: f.name, collaborative: !!f.collaborative })),
    values,
    setValue,
  } : null,
)
```

**Step 3: Update `setValue` to sync collaborative fields**

```ts
function setValue(name: string, value: unknown) {
  setValues((prev) => ({ ...prev, [name]: value }))
  setErrors((prev) => ({ ...prev, [name]: [] }))
  const field = formFields.find(f => f.name === name)
  if (field?.collaborative && collab) collab.setCollaborativeValue(name, value)
}
```

**Step 4: Versioned save endpoint + sync to ydoc before save**

In `handleSubmit`, before fetch:

```ts
if (versioned && collab) collab.syncAllFieldsToDoc(values)
```

Replace fetch URL:

```ts
const saveUrl = versioned
  ? `/${pathSegment}/api/${slug}/${id}/_versions`
  : `/${pathSegment}/api/${slug}/${id}`

const res = await fetch(saveUrl, {
  method:  versioned ? 'POST' : 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify(versioned ? { ...values, label: undefined } : values),
})
```

**Step 5: Add presence indicator after breadcrumbs**

```tsx
{hasCollaboration && collab.presences.length > 0 && (
  <div className="flex items-center gap-2 mb-4">
    <span className="text-xs text-muted-foreground">Editing:</span>
    <div className="flex -space-x-1">
      {collab.presences.map((p, i) => (
        <span key={i} className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-background" style={{ backgroundColor: p.color }} title={p.name}>
          {p.name[0]}
        </span>
      ))}
    </div>
    <span className={`w-1.5 h-1.5 rounded-full ${collab.connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
  </div>
)}
```

**Step 6: Add version history state + UI**

```ts
const [versions, setVersions]               = useState<{ id: string; label?: string; createdAt: string }[]>([])
const [showVersions, setShowVersions]       = useState(false)
const [loadingVersions, setLoadingVersions] = useState(false)

async function loadVersions() {
  setLoadingVersions(true)
  try {
    const r = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions`)
    if (r.ok) setVersions((await r.json() as any).data)
  } catch {}
  setLoadingVersions(false)
}

async function restoreVersion(versionId: string) {
  try {
    const r = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions/${versionId}`)
    if (!r.ok) return
    const body = await r.json() as { data: { fields: Record<string, unknown> } }
    setValues(prev => ({ ...prev, ...body.data.fields }))
    if (collab) collab.syncAllFieldsToDoc({ ...values, ...body.data.fields })
    toast.success(i18n.versionRestored ?? 'Version restored. Save to publish.')
  } catch { toast.error('Failed to restore version.') }
}
```

History toggle button (next to save):

```tsx
{versioned && (
  <button type="button" onClick={() => { setShowVersions(v => !v); if (!showVersions) void loadVersions() }}
    className="px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors">
    {showVersions ? i18n.hideVersions ?? 'Hide History' : i18n.showVersions ?? 'History'}
  </button>
)}
```

Version list panel (after form):

```tsx
{showVersions && versioned && (
  <div className="mt-6 rounded-xl border border-border bg-card p-5">
    <h3 className="text-sm font-semibold mb-3">Version History</h3>
    {loadingVersions ? (
      <p className="text-xs text-muted-foreground">Loading...</p>
    ) : versions.length === 0 ? (
      <p className="text-xs text-muted-foreground">No versions yet. Save to create the first version.</p>
    ) : (
      <div className="space-y-2">
        {versions.map(v => (
          <div key={v.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
            <div>
              <span className="font-medium">{v.label || 'Auto-save'}</span>
              <span className="text-xs text-muted-foreground ml-2">{new Date(v.createdAt).toLocaleString()}</span>
            </div>
            <button type="button" onClick={() => void restoreVersion(v.id)} className="text-xs text-primary hover:underline">Restore</button>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 7: Add i18n strings**

`en.ts`:
```ts
showVersions:    'History',
hideVersions:    'Hide History',
versionRestored: 'Version restored. Save to publish.',
```

`ar.ts`:
```ts
showVersions:    'السجل',
hideVersions:    'إخفاء السجل',
versionRestored: 'تمت استعادة النسخة. احفظ للنشر.',
```

**Step 8: Build and commit**

```bash
cd packages/panels && pnpm build
git add packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx packages/panels/src/i18n/en.ts packages/panels/src/i18n/ar.ts
git commit -m "feat(panels): wire collaborative form + version history into edit page"
```

---

## Task 11: Playground demo

**Files:**
- Modify: `playground/app/Panels/Admin/resources/ArticleResource.ts`
- Modify: `playground/app/Panels/Admin/resources/TodoResource.ts`
- Modify: `playground/bootstrap/providers.ts`

**Step 1: TodoResource — live table only**

```ts
static live = true  // table auto-updates
static paginationType = 'loadMore' as const
static perPage = 5
static persistTableState = true
```

**Step 2: ArticleResource — full combo**

```ts
static live      = true
static versioned = true
static persistTableState = true

// In fields():
TextField.make('title').label('Title').required().searchable().sortable().collaborative(),
TextareaField.make('body').label('Body').collaborative(),
```

**Step 3: Ensure providers include both `broadcasting()` and `live()`**

```ts
import { broadcasting } from '@boostkit/broadcast'
import { live } from '@boostkit/live'

export default [
  // ...
  broadcasting(),
  live(),
]
```

**Step 4: Add deps if needed**

```bash
cd playground && pnpm add yjs y-websocket
```

**Step 5: Manual test**

1. `cd playground && pnpm dev`
2. **Live table**: Open Todos in two tabs. Create a todo in tab 1. Tab 2 auto-refreshes.
3. **Versioned + collaborative**: Open Article edit in two tabs. Type in title (tab 1) → appears in tab 2. Save → version created. Click History → version list. Restore → form updates.

**Step 6: Commit**

```bash
git add playground/
git commit -m "feat(playground): demo live table, versioning, and collaboration"
```

---

## Task 12: Update docs

**Files:**
- Modify: `packages/panels/README.md`
- Modify: `docs/packages/panels.md`
- Modify: `packages/live/README.md`

**Step 1: Panels docs — three features**

```markdown
### Live Table

Auto-refresh the table when records change:

\`\`\`ts
export class TodoResource extends Resource {
  static live = true
}
\`\`\`

Requires `@boostkit/broadcast` in your providers. When any user creates, updates, or deletes a record, all viewers see the change instantly — no page refresh needed.

### Version History

Enable Yjs-backed version history:

\`\`\`ts
export class ArticleResource extends Resource {
  static versioned = true
}
\`\`\`

Each save creates a snapshot. View and restore previous versions from the edit page. Requires `@boostkit/live` in your providers.

### Real-Time Collaboration

Mark individual fields for live multi-user editing:

\`\`\`ts
fields() {
  return [
    TextField.make('title').collaborative(),
    TextareaField.make('body').collaborative(),
    SelectField.make('status'), // normal field
  ]
}
\`\`\`

Requires `static versioned = true` and `@boostkit/live` in providers.
```

**Step 2: Live README — document `Live` facade**

```markdown
### Live Facade

Programmatic access to Yjs documents from server-side code:

\`\`\`ts
import { Live } from '@boostkit/live'

await Live.seed('my-doc', { title: 'Hello' })
const snapshot = Live.snapshot('my-doc')
const fields   = Live.readMap('my-doc', 'fields')
\`\`\`
```

**Step 3: Build and commit**

```bash
pnpm build
git add packages/panels/README.md docs/packages/panels.md packages/live/README.md
git commit -m "docs: add live table, versioning, collaboration, and Live facade docs"
```

---

## Summary

| Task | Feature | Key Files |
|---|---|---|
| **1** | **`static live = true`** — broadcast on CRUD mutations | `Resource.ts`, `PanelServiceProvider.ts` |
| **2** | `useLiveTable` hook — table auto-refresh on broadcast | `_hooks/useLiveTable.ts`, `+Page.tsx` |
| **3** | **`Live` facade** + DI + async fix + `livePrisma` reuse | `packages/live/src/index.ts` |
| **4** | **`.collaborative()`** on Field + FieldMeta | `Field.ts` |
| **5** | **`static versioned = true`** on Resource | `Resource.ts` |
| **6** | `PanelVersion` Prisma model | `playground/prisma/schema.prisma` |
| **7** | Version history API routes (uses `Live` facade) | `PanelServiceProvider.ts` |
| **8** | Seed ydoc on edit page load (uses `Live.seed()`) | `edit/+data.ts` |
| **9** | `useCollaborativeForm` hook | `_hooks/useCollaborativeForm.ts` |
| **10** | Wire collab form + version history into edit page | `edit/+Page.tsx`, i18n |
| **11** | Playground demo | `playground/` |
| **12** | Docs | README + docs |

### Three layers — independent, composable

| Layer | Flag | Package | Yjs? | Use case |
|---|---|---|---|---|
| **Live table** | `static live = true` | `@boostkit/broadcast` | No | Real-time table updates |
| **Versioning** | `static versioned = true` | `@boostkit/live` | Yes | Draft history, snapshots, restore |
| **Collaboration** | `.collaborative()` | `@boostkit/live` | Yes | Per-field live editing between users |

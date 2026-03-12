# Panels Versioning + Collaboration (Yjs) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Yjs-backed version history and optional real-time collaboration to Panels resources, using `@boostkit/live` as the sync layer.

**Architecture:**
- DB record = published/saved state (unchanged semantics for all existing non-versioned resources)
- ydoc per record = live working state — CRDT diff log IS the history
- On every explicit Save: take a binary `Y.encodeStateAsUpdate(doc)` snapshot → store in new `PanelVersion` table
- `@boostkit/live` gains two new utilities: `seedDocument(docName, initFn)` and `snapshotDocument(docName)` (read-only, no persistence change)
- Frontend edit form for versioned resources: connects via `y-websocket` `WebsocketProvider`, keeps `ydoc.getMap('fields')` bidirectional with React form state
- Presence awareness shown when `collaborative: true`

**Tech Stack:** Yjs, y-websocket, `@boostkit/live`, `@boostkit/panels`, Prisma, React

---

## Glossary

| Term | Meaning |
|---|---|
| docName | Unique Yjs doc identifier: `panel:{resourceSlug}:{recordId}` |
| ydoc | Y.Doc instance held in-memory by `@boostkit/live`'s room manager |
| snapshot | `Uint8Array` from `Y.encodeStateAsUpdate(doc)` — full doc state at a point in time |
| versioned | `static versioned = true` on a Resource — enables version history |
| collaborative | `static collaborative = false` — enables multi-user live editing (presence) |

---

## Task 1: New utilities in `@boostkit/live`

**Files:**
- Modify: `packages/live/src/index.ts`

These two utilities let the panels backend seed a ydoc from an existing DB record (first open) and read the current state as a snapshot (on save).

**Step 1: Read the current export list**

Run: `grep -n "^export" packages/live/src/index.ts`

**Step 2: Add `seedDocument` utility after the `getOrCreateRoom` function (~line 219)**

```ts
// ─── Public utilities ────────────────────────────────────────

/**
 * seedDocument — ensure a ydoc is initialised with initial data.
 *
 * If the room's ydoc has no content yet (empty state vector),
 * calls `initFn()` to obtain a plain object and writes its values
 * into `ydoc.getMap('fields')`.
 *
 * Safe to call multiple times — only seeds once per lifetime of the room.
 *
 * @param docName  - Yjs document name (e.g. `panel:articles:42`)
 * @param initFn   - Async function returning initial field values
 * @param persistence - LivePersistence to use (same instance as the live() provider)
 */
export async function seedDocument(
  docName:     string,
  initFn:      () => Promise<Record<string, unknown>>,
  persistence: LivePersistence,
): Promise<void> {
  const room = getOrCreateRoom(docName, persistence)
  // Y.encodeStateVector returns [0] when doc is empty
  const sv = Y.encodeStateVector(room.doc)
  if (sv.length > 1) return  // already has content

  // Also check persistence (doc might be persisted but room just created)
  const persisted = await persistence.getYDoc(docName)
  const pSv = Y.encodeStateVector(persisted)
  if (pSv.length > 1) {
    // Apply persisted state into room doc
    const update = Y.encodeStateAsUpdate(persisted)
    Y.applyUpdate(room.doc, update)
    return
  }

  // Truly new document — seed from DB
  const data   = await initFn()
  const fields = room.doc.getMap('fields')
  room.doc.transact(() => {
    for (const [key, value] of Object.entries(data)) {
      fields.set(key, value)
    }
  })

  // Persist the initial state
  const update = Y.encodeStateAsUpdate(room.doc)
  await persistence.storeUpdate(docName, update)
}

/**
 * snapshotDocument — return the current full state of a ydoc as a binary snapshot.
 *
 * The returned Uint8Array can be stored (e.g. in `PanelVersion.snapshot`) and later
 * applied to a fresh Y.Doc to restore the state.
 *
 * Returns null if the document has no in-memory room (was never opened this session).
 * Callers should load via persistence if needed.
 *
 * @param docName - Yjs document name
 */
export function snapshotDocument(docName: string): Uint8Array | null {
  const rooms = (globalThis as Record<string, unknown>)[KEY] as Map<string, Room> | undefined
  const room  = rooms?.get(docName)
  if (!room) return null
  return Y.encodeStateAsUpdate(room.doc)
}
```

**Step 3: Export `seedDocument` and `snapshotDocument` from `packages/live/src/index.ts`**

They are already inline exports — confirm they appear in `packages/live/src/index.ts` after the edit.

**Step 4: Build `@boostkit/live`**

```bash
cd packages/live && pnpm build
```

Expected: no TypeScript errors.

**Step 5: Commit**

```bash
git add packages/live/src/index.ts
git commit -m "feat(live): add seedDocument and snapshotDocument utilities"
```

---

## Task 2: Prisma schema — `PanelVersion` model

**Files:**
- Modify: `playground/prisma/schema.prisma`

**Step 1: Add `PanelVersion` model at end of schema.prisma**

```prisma
model PanelVersion {
  id           String   @id @default(cuid())
  docName      String
  resourceSlug String
  recordId     String
  snapshot     Bytes
  label        String?
  createdAt    DateTime @default(now())

  @@index([docName])
  @@index([resourceSlug, recordId])
}
```

**Step 2: Push schema to DB (playground dev)**

```bash
cd playground && pnpm exec prisma db push
```

Expected: `PanelVersion` table created.

**Step 3: Commit**

```bash
git add playground/prisma/schema.prisma
git commit -m "feat(panels): add PanelVersion model to Prisma schema"
```

---

## Task 3: `Resource` static flags

**Files:**
- Modify: `packages/panels/src/Resource.ts`
- Modify: `packages/panels/src/Resource.ts` — `ResourceMeta` interface

**Step 1: Add static properties after `static titleField?` (~line 58)**

```ts
/**
 * Enable Yjs-backed version history for this resource.
 * Requires `@boostkit/live` with a non-memory persistence adapter (livePrisma / liveRedis).
 * When true, every Save creates a version snapshot in `PanelVersion`.
 */
static versioned = false

/**
 * Enable real-time collaborative editing (multiple users in the same edit form).
 * Implies `versioned = true`.
 * Awareness cursors shown when multiple users are present.
 */
static collaborative = false

/**
 * Maximum number of versions to retain per record.
 * Oldest versions are pruned when the limit is exceeded.
 */
static maxVersions = 50
```

**Step 2: Add versioning flags to `ResourceMeta` interface (~line 16)**

```ts
export interface ResourceMeta {
  label:           string
  labelSingular:   string
  slug:            string
  icon:            string | undefined
  fields:          SchemaItemMeta[]
  filters:         ReturnType<Filter['toMeta']>[]
  actions:         ReturnType<Action['toMeta']>[]
  defaultSort?:    string
  defaultSortDir?: 'ASC' | 'DESC'
  titleField?:     string
  versioned:       boolean       // <-- add this
  collaborative:   boolean       // <-- add this
}
```

**Step 3: Include versioning flags in `toMeta()` (~line 124)**

```ts
meta.versioned     = Cls.versioned || Cls.collaborative
meta.collaborative = Cls.collaborative
```

**Step 4: Build panels**

```bash
cd packages/panels && pnpm build
```

**Step 5: Commit**

```bash
git add packages/panels/src/Resource.ts
git commit -m "feat(panels): add versioned/collaborative/maxVersions static flags to Resource"
```

---

## Task 4: Backend — `/_doc` seed endpoint + version endpoints in `PanelServiceProvider`

**Files:**
- Modify: `packages/panels/src/PanelServiceProvider.ts`

These endpoints are conditionally mounted only when `ResourceClass.versioned || ResourceClass.collaborative`.

**Step 1: Read current `mountResource` to understand how to insert new routes (~line 188)**

Already read — insert after the `GET /:id` route block (after line 349).

**Step 2: Add versioning route block inside `mountResource`, after the `GET /:id` block**

```ts
// ── Versioning routes (only when resource.versioned or .collaborative) ──
if (ResourceClass.versioned || ResourceClass.collaborative) {
  const isCollaborative = ResourceClass.collaborative

  // ── GET /:id/_doc — ensure ydoc is seeded, return docName ─────────
  router.get(`${base}/:id/_doc`, async (req, res) => {
    const id      = (req.params as Record<string, string>)['id']
    const docName = `panel:${slug}:${id}`

    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    // Get the live persistence instance from DI
    let persistence: import('@boostkit/live').LivePersistence
    try {
      const { app } = await import('@boostkit/core') as any
      persistence    = app().make('live:persistence')
    } catch {
      return res.status(500).json({ message: 'Live persistence not registered. Add live() to providers with livePrisma() or liveRedis() adapter.' })
    }

    // Load the DB record to seed initial ydoc state
    const record = await Model.find(id)
    if (!record) return res.status(404).json({ message: 'Record not found.' })

    const { seedDocument } = await import('@boostkit/live')
    await seedDocument(
      docName,
      async () => {
        // Convert record to plain field map
        const resource = new ResourceClass()
        const fields   = flattenFields(resource.fields())
        const data: Record<string, unknown> = {}
        for (const f of fields) {
          const name = f.getName()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const val  = (record as any)[name]
          if (val !== undefined) data[name] = val
        }
        return data
      },
      persistence,
    )

    return res.json({ docName, collaborative: isCollaborative })
  }, mw)

  // ── GET /:id/_versions — list versions ────────────────────────────
  router.get(`${base}/:id/_versions`, async (req, res) => {
    const id = (req.params as Record<string, string>)['id']

    let prisma: any
    try {
      const { app }  = await import('@boostkit/core') as any
      prisma          = app().make('prisma')
    } catch {
      return res.status(500).json({ message: 'Prisma not registered.' })
    }

    const versions = await prisma.panelVersion.findMany({
      where:   { resourceSlug: slug, recordId: String(id) },
      select:  { id: true, label: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    50,
    })

    return res.json({ data: versions })
  }, mw)

  // ── POST /:id/_versions — create a named snapshot ─────────────────
  router.post(`${base}/:id/_versions`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = this.buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const id      = (req.params as Record<string, string>)['id']
    const docName = `panel:${slug}:${id}`
    const label   = ((req.body as Record<string, unknown>)['label'] as string | undefined) ?? undefined

    const { snapshotDocument } = await import('@boostkit/live')
    const snapshot = snapshotDocument(docName)
    if (!snapshot) return res.status(404).json({ message: 'Document not open — open the edit form first.' })

    let prisma: any
    try {
      const { app } = await import('@boostkit/core') as any
      prisma         = app().make('prisma')
    } catch {
      return res.status(500).json({ message: 'Prisma not registered.' })
    }

    const maxVersions = ResourceClass.maxVersions
    const version = await prisma.panelVersion.create({
      data: {
        docName,
        resourceSlug: slug,
        recordId:     String(id),
        snapshot:     Buffer.from(snapshot),
        label:        label ?? null,
      },
    })

    // Prune old versions beyond maxVersions
    const oldest = await prisma.panelVersion.findMany({
      where:   { resourceSlug: slug, recordId: String(id) },
      orderBy: { createdAt: 'desc' },
      skip:    maxVersions,
      select:  { id: true },
    })
    if (oldest.length > 0) {
      await prisma.panelVersion.deleteMany({
        where: { id: { in: oldest.map((v: any) => v.id) } },
      })
    }

    return res.status(201).json({ data: { id: version.id, label: version.label, createdAt: version.createdAt } })
  }, mw)

  // ── POST /:id/_versions/:versionId/restore — restore a version ────
  router.post(`${base}/:id/_versions/:versionId/restore`, async (req, res) => {
    const resource = new ResourceClass()
    const ctx      = this.buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })
    if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

    const id        = (req.params as Record<string, string>)['id']
    const versionId = (req.params as Record<string, string>)['versionId']
    const docName   = `panel:${slug}:${id}`

    let prisma: any
    try {
      const { app } = await import('@boostkit/core') as any
      prisma         = app().make('prisma')
    } catch {
      return res.status(500).json({ message: 'Prisma not registered.' })
    }

    const versionRow = await prisma.panelVersion.findUnique({ where: { id: versionId } })
    if (!versionRow) return res.status(404).json({ message: 'Version not found.' })

    // Re-apply snapshot to a fresh ydoc, then extract field values
    const * as Y = await import('yjs')
    const freshDoc = new Y.Doc()
    Y.applyUpdate(freshDoc, new Uint8Array(versionRow.snapshot))

    const fields    = freshDoc.getMap('fields')
    const resInst   = new ResourceClass()
    const fieldDefs = flattenFields(resInst.fields())
    const body: Record<string, unknown> = {}
    for (const f of fieldDefs) {
      const val = fields.get(f.getName())
      if (val !== undefined) body[f.getName()] = val
    }

    // Coerce + validate
    const coerced = this.coercePayload(resInst, body, 'update')
    const errors  = this.validatePayload(resInst, coerced, 'update')
    if (errors) return res.status(422).json({ message: 'Restored data failed validation.', errors })

    // Update DB record
    const record = await Model.query().update(id, coerced)

    // Clear the live document so it gets re-seeded on next open
    let persistence: import('@boostkit/live').LivePersistence | undefined
    try {
      const { app } = await import('@boostkit/core') as any
      persistence    = app().make('live:persistence')
    } catch { /* ignore */ }
    if (persistence) await persistence.clearDocument(docName)

    return res.json({ data: record, message: 'Version restored.' })
  }, mw)
}
```

**Step 3: Modify the PUT `/:id` update handler to auto-snapshot when versioned**

Inside the PUT handler, after `if (!exists)` check and before the update, add:

```ts
// Auto-snapshot current state before overwriting (version history)
if (ResourceClass.versioned || ResourceClass.collaborative) {
  const docName = `panel:${slug}:${id}`
  try {
    const { snapshotDocument } = await import('@boostkit/live')
    const snapshot = snapshotDocument(docName)
    if (snapshot) {
      const { app } = await import('@boostkit/core') as any
      const prismaClient = app().make('prisma')
      const maxVersions  = ResourceClass.maxVersions

      await prismaClient.panelVersion.create({
        data: { docName, resourceSlug: slug, recordId: String(id), snapshot: Buffer.from(snapshot), label: null },
      })

      // Prune old versions
      const oldest = await prismaClient.panelVersion.findMany({
        where:   { resourceSlug: slug, recordId: String(id) },
        orderBy: { createdAt: 'desc' },
        skip:    maxVersions,
        select:  { id: true },
      })
      if (oldest.length > 0) {
        await prismaClient.panelVersion.deleteMany({
          where: { id: { in: oldest.map((v: any) => v.id) } },
        })
      }
    }
  } catch { /* live not configured — skip snapshotting */ }
}
```

**Step 4: Register `live:persistence` in the live ServiceProvider**

The `live()` factory in `@boostkit/live` needs to bind the persistence instance to the DI container so `PanelServiceProvider` can retrieve it.

In `packages/live/src/index.ts`, inside `LiveServiceProvider.boot()`, add after creating `persistence`:

```ts
// Bind persistence to DI so other providers (e.g. panels) can use it
this.app.bind('live:persistence', () => persistence)
```

The `this.app` is available on every ServiceProvider — `Application` is passed to the constructor and stored as `this.app`.

**Step 5: Build panels**

```bash
cd packages/panels && pnpm build
```

**Step 6: Commit**

```bash
git add packages/panels/src/PanelServiceProvider.ts packages/live/src/index.ts
git commit -m "feat(panels): add _doc seed + version history endpoints; bind live:persistence to DI"
```

---

## Task 5: Frontend — ydoc integration in edit form

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`
- Modify: `playground/pages/(panels)/@panel/@resource/+Page.tsx` (copy)

> **Note:** Both files are identical — changes must be applied to both. The playground copy is the one actually served; the packages/ copy is the publishable template.

**Step 1: Install y-websocket client in panels package (and playground)**

```bash
cd packages/panels && pnpm add yjs y-websocket
cd playground && pnpm add yjs y-websocket
```

y-websocket provides the `WebsocketProvider` class that connects to `/ws-live/{docName}` automatically.

**Step 2: Understand existing `EditForm` component structure**

Read `packages/panels/pages/@panel/@resource/+Page.tsx` — look for `EditForm` component, `initialValues`, `handleSubmit`.

**Step 3: Add ydoc connection hook**

Add at top of file (with other imports):

```tsx
import * as Y                 from 'yjs'
import { WebsocketProvider }  from 'y-websocket'
```

Add a new hook `useVersionedDoc` above the `EditForm` component:

```tsx
/**
 * useVersionedDoc — connects the edit form to a Yjs document via y-websocket.
 * Only active when resource.versioned or resource.collaborative.
 *
 * Returns: { ydoc, connected, peers }
 *   - ydoc: the Y.Doc — read/write form fields via ydoc.getMap('fields')
 *   - connected: boolean — WebsocketProvider is synced
 *   - peers: number — how many other users are currently in the doc (for awareness)
 */
function useVersionedDoc(
  resourceMeta: ResourceMeta,
  recordId: string | undefined,
): { ydoc: Y.Doc | null; connected: boolean; peers: number } {
  const [connected, setConnected] = React.useState(false)
  const [peers,     setPeers]     = React.useState(0)
  const ydocRef                   = React.useRef<Y.Doc | null>(null)
  const providerRef               = React.useRef<WebsocketProvider | null>(null)

  const enabled = (resourceMeta.versioned || resourceMeta.collaborative) && !!recordId

  React.useEffect(() => {
    if (!enabled) return

    // 1. Seed the doc on the server side (ensure it has initial data)
    fetch(`/_panels/api/${resourceMeta.slug}/${recordId}/_doc`)
      .then(r => r.json())
      .then(({ docName, collaborative }: { docName: string; collaborative: boolean }) => {
        const ydoc    = new Y.Doc()
        ydocRef.current = ydoc

        const wsUrl   = `ws://${window.location.host}/ws-live`
        const provider = new WebsocketProvider(wsUrl, docName, ydoc, { connect: true })
        providerRef.current = provider

        provider.on('sync',   (isSynced: boolean) => setConnected(isSynced))
        provider.on('status', ({ status }: { status: string }) => {
          if (status === 'disconnected') setConnected(false)
        })

        if (collaborative) {
          provider.awareness.on('change', () => {
            const states = provider.awareness.getStates()
            // -1 to exclude self
            setPeers(Math.max(0, states.size - 1))
          })
        }
      })
      .catch(() => { /* versioning unavailable — degrade gracefully */ })

    return () => {
      providerRef.current?.destroy()
      ydocRef.current?.destroy()
      ydocRef.current    = null
      providerRef.current = null
    }
  }, [enabled, recordId, resourceMeta.slug])

  return { ydoc: ydocRef.current, connected, peers }
}
```

**Step 4: Wire `useVersionedDoc` into `EditForm`**

Inside `EditForm`, after loading the record (after `fetchRecord` resolves), call:

```tsx
const { ydoc, connected, peers } = useVersionedDoc(resourceMeta, id)
```

When the ydoc is synced, read initial values from it (overriding the DB values). When the user changes a form field, write back to the ydoc:

```tsx
// When ydoc syncs for the first time, populate form state from ydoc
React.useEffect(() => {
  if (!ydoc || !connected) return
  const fields = ydoc.getMap('fields')
  const snapshot: Record<string, unknown> = {}
  for (const [key, value] of fields.entries()) {
    snapshot[key] = value
  }
  if (Object.keys(snapshot).length > 0) {
    setValues(prev => ({ ...prev, ...snapshot }))
  }
}, [ydoc, connected])

// On every form value change, write to ydoc (debounced ~300ms)
React.useEffect(() => {
  if (!ydoc || !connected) return
  const timer = setTimeout(() => {
    const fields = ydoc.getMap('fields')
    ydoc.transact(() => {
      for (const [key, value] of Object.entries(values)) {
        fields.set(key, value)
      }
    })
  }, 300)
  return () => clearTimeout(timer)
}, [values, ydoc, connected])
```

**Step 5: Add presence indicator and version history button in edit form header**

In the edit form header (near the "Save" button), add:

```tsx
{/* Collaborative presence */}
{resourceMeta.collaborative && peers > 0 && (
  <span className="text-xs text-muted-foreground">
    {peers} other {peers === 1 ? 'user' : 'users'} editing
  </span>
)}

{/* Version history button */}
{(resourceMeta.versioned || resourceMeta.collaborative) && id && (
  <button
    type="button"
    onClick={() => setVersionDrawerOpen(true)}
    className="text-xs underline text-muted-foreground"
  >
    Version history
  </button>
)}
```

**Step 6: Add `VersionHistoryDrawer` component**

Add a sidebar/drawer that:
1. Fetches `GET /_panels/api/{resource}/{id}/_versions` on open
2. Lists versions with relative timestamps
3. "Restore" button → `POST /_panels/api/{resource}/{id}/_versions/{versionId}/restore` → reloads form

```tsx
function VersionHistoryDrawer({
  resourceSlug, recordId, panelSlug, open, onClose, onRestored,
}: {
  resourceSlug: string
  recordId:     string
  panelSlug:    string
  open:         boolean
  onClose():    void
  onRestored(): void
}) {
  const [versions, setVersions] = React.useState<Array<{ id: string; label: string | null; createdAt: string }>>([])
  const [loading,  setLoading]  = React.useState(false)
  const [restoring, setRestoring] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/_panels/api/${resourceSlug}/${recordId}/_versions`)
      .then(r => r.json())
      .then(({ data }) => { setVersions(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open, resourceSlug, recordId])

  const restore = async (versionId: string) => {
    setRestoring(versionId)
    await fetch(`/_panels/api/${resourceSlug}/${recordId}/_versions/${versionId}/restore`, { method: 'POST' })
    setRestoring(null)
    onClose()
    onRestored()
  }

  if (!open) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 bg-background border-l shadow-lg p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Version history</h3>
        <button onClick={onClose} type="button" className="text-muted-foreground">✕</button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions yet. Versions are created on each Save.</p>
      ) : (
        <ul className="space-y-2">
          {versions.map(v => (
            <li key={v.id} className="flex items-center justify-between text-sm border rounded p-2">
              <div>
                <p className="font-medium">{v.label ?? 'Auto-save'}</p>
                <p className="text-muted-foreground text-xs">
                  {new Date(v.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restore(v.id)}
                disabled={restoring === v.id}
                className="text-xs underline disabled:opacity-50"
              >
                {restoring === v.id ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

**Step 7: Wire `VersionHistoryDrawer` into EditForm**

Add state:

```tsx
const [versionDrawerOpen, setVersionDrawerOpen] = React.useState(false)
```

Add JSX at end of EditForm return:

```tsx
{(resourceMeta.versioned || resourceMeta.collaborative) && id && (
  <VersionHistoryDrawer
    resourceSlug={resourceMeta.slug}
    recordId={id}
    panelSlug={panelSlug}
    open={versionDrawerOpen}
    onClose={() => setVersionDrawerOpen(false)}
    onRestored={() => fetchRecord()}
  />
)}
```

**Step 8: Build panels**

```bash
cd packages/panels && pnpm build
```

Expected: clean build.

**Step 9: Commit**

```bash
git add packages/panels/pages/@panel/@resource/+Page.tsx
git add playground/pages/\(panels\)/@panel/@resource/+Page.tsx
git commit -m "feat(panels): add Yjs ydoc form integration, presence indicator, version history drawer"
```

---

## Task 6: Demo — `ArticleResource` with versioned + collaborative

**Files:**
- Modify: `playground/app/Panels/AdminPanel/Resources/ArticleResource.ts`

**Step 1: Read current ArticleResource**

```bash
cat playground/app/Panels/AdminPanel/Resources/ArticleResource.ts
```

**Step 2: Add static versioned flag**

```ts
static versioned     = true
static collaborative = true
static maxVersions   = 30
```

**Step 3: Start the playground and verify**

```bash
cd playground && pnpm dev
```

Open `http://localhost:3000/_panels/admin/articles/1/edit`.

Expected:
- "Version history" button appears in header
- (With `live()` and `livePrisma()` registered) doc seeds from DB on first open
- On Save → version created

**Step 4: Verify version endpoint**

```bash
curl http://localhost:3000/_panels/api/articles/1/_versions
# Expected: { data: [...] }
```

**Step 5: Commit**

```bash
git add playground/app/Panels/AdminPanel/Resources/ArticleResource.ts
git commit -m "demo: enable versioned + collaborative on ArticleResource"
```

---

## Task 7: Register `live()` with `livePrisma()` in playground

**Files:**
- Modify: `playground/bootstrap/providers.ts`

**Step 1: Import live utilities**

```ts
import { live, livePrisma } from '@boostkit/live'
```

**Step 2: Add to providers array**

```ts
live({ persistence: livePrisma() }),
```

Place it **after** `database()` and **before** `panels()` (so DI has prisma bound before live tries to use it).

**Step 3: Verify no TS errors**

```bash
cd playground && pnpm typecheck
```

**Step 4: Commit**

```bash
git add playground/bootstrap/providers.ts
git commit -m "demo: register live() with livePrisma() in playground"
```

---

## Task 8: Docs update

**Files:**
- Modify: `docs/packages/panels.md`
- Modify: `packages/panels/README.md`
- Modify: `docs/packages/live.md` (if exists)

**Step 1: Read current panels doc**

```bash
head -100 docs/packages/panels.md
```

**Step 2: Add "Version History & Collaboration" section in docs/packages/panels.md**

Add after the "File Uploads" section:

```markdown
## Version History & Collaboration

Panels integrates with `@boostkit/live` (Yjs) to provide version history and optional real-time collaboration.

### Setup

1. Add `live()` to your providers with a durable persistence adapter:

```ts
// bootstrap/providers.ts
import { live, livePrisma } from '@boostkit/live'

export default [
  database(configs.database),
  live({ persistence: livePrisma() }),  // Requires @prisma/client
  panels(adminPanel),
]
```

2. Add `PanelVersion` to your Prisma schema:

```prisma
model PanelVersion {
  id           String   @id @default(cuid())
  docName      String
  resourceSlug String
  recordId     String
  snapshot     Bytes
  label        String?
  createdAt    DateTime @default(now())

  @@index([docName])
  @@index([resourceSlug, recordId])
}
```

3. Enable versioning on a Resource:

```ts
export class ArticleResource extends Resource {
  static versioned     = true   // enables version history
  static collaborative = true   // enables multi-user editing + presence
  static maxVersions   = 50     // max retained snapshots per record
  // ...
}
```

### How it works

- **DB record** = the saved/published state. All existing list/show reads use the DB directly.
- **ydoc** = the live working state. When you open an edit form for a versioned record, the frontend connects via `y-websocket` to `/ws-live/panel:{resource}:{id}`.
- **On first open**: the ydoc is seeded from the DB record's current field values (`seedDocument()`).
- **On Save**: a binary snapshot of the ydoc is stored in `PanelVersion`. The DB record is updated with the submitted form data. The old ydoc state becomes a version.
- **Version restore**: selecting a version re-applies the stored snapshot to the DB record and clears the ydoc (so the next open re-seeds from the restored state).

### Version history UI

- **"Version history" button** appears in the edit form header for all `versioned` resources.
- Clicking it opens a sidebar listing all saved versions with timestamps.
- Each version has a **Restore** button.
- Versions are created automatically on every Save (labelled "Auto-save").

### Collaborative editing

When `collaborative: true`, multiple users can edit the same record simultaneously:
- Form fields sync via CRDT — no conflicts, last-write wins per field by default (Yjs Y.Map merge).
- A presence indicator shows: `"2 other users editing"`.
- Awareness (cursor positions) is forwarded by the live provider.
```

**Step 3: Add the same section to README.md (condensed)**

**Step 4: Commit**

```bash
git add docs/packages/panels.md packages/panels/README.md
git commit -m "docs(panels): document Yjs version history and collaborative editing"
```

---

## Task 9: Changeset

**Step 1: Create changeset**

```bash
pnpm changeset
```

Select packages: `@boostkit/live`, `@boostkit/panels`

Type: `minor` for both

Description:
```
feat: Yjs-backed version history and real-time collaboration for Panels resources

- `@boostkit/live`: new `seedDocument()` and `snapshotDocument()` utilities; `live:persistence` bound to DI container
- `@boostkit/panels`: `Resource.versioned`, `Resource.collaborative`, `Resource.maxVersions` flags; `/_doc`, `/_versions`, `/_versions/:id/restore` endpoints; `VersionHistoryDrawer` + presence indicator in edit form
```

**Step 2: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for live + panels versioning release"
```

---

## Quick reference — new API surface

### Resource

```ts
export class MyResource extends Resource {
  static versioned     = true   // default: false
  static collaborative = false  // default: false (implies versioned)
  static maxVersions   = 50     // default: 50
}
```

### `@boostkit/live` new exports

```ts
import { seedDocument, snapshotDocument } from '@boostkit/live'

// Seed a ydoc from an external source (called by panels automatically)
await seedDocument('panel:articles:42', async () => ({ title: 'Hello', ...}), persistence)

// Take a binary snapshot of the current in-memory ydoc state
const snapshot: Uint8Array | null = snapshotDocument('panel:articles:42')
```

### New API endpoints (per versioned resource)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/{panel}/api/{resource}/:id/_doc` | Seed ydoc + return `{ docName, collaborative }` |
| GET | `/{panel}/api/{resource}/:id/_versions` | List version snapshots |
| POST | `/{panel}/api/{resource}/:id/_versions` | Create named snapshot |
| POST | `/{panel}/api/{resource}/:id/_versions/:versionId/restore` | Restore a version |

### Provider registration

```ts
// bootstrap/providers.ts
live({ persistence: livePrisma() })  // must come before panels()
```

### Prisma model (add to schema.prisma)

```prisma
model PanelVersion {
  id           String   @id @default(cuid())
  docName      String
  resourceSlug String
  recordId     String
  snapshot     Bytes
  label        String?
  createdAt    DateTime @default(now())

  @@index([docName])
  @@index([resourceSlug, recordId])
}
```

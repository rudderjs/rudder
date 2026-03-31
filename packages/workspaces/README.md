# @boostkit/workspaces

AI workspace builder for BoostKit — collaborative 3D canvas with departments, agents, knowledge bases, and connections.

## Installation

```bash
pnpm add @boostkit/workspaces
```

For the 3D canvas (optional peer deps):

```bash
pnpm add three @react-three/fiber @react-three/drei yjs y-websocket y-indexeddb
```

## Setup

```ts
import { Panel } from '@boostkit/panels'
import { workspaces } from '@boostkit/workspaces'

export const adminPanel = Panel.make('admin')
  .use(workspaces())
  .resources([...])
```

Publish schema and run migrations:

```bash
pnpm artisan vendor:publish --tag=workspaces-schema
pnpm exec prisma generate
pnpm exec prisma db push
```

## Data Model

Single `Workspace` table with a `nodes` JSON column. All workspace entities (departments, agents, KB, connections) are stored as nodes in a flat map — no separate tables.

```
Workspace
  └── nodes (JSON) → flat Y.Map
        ├── root
        ├── dept-sales     (type: department, parentId: root)
        ├── agent-coach    (type: agent, parentId: dept-sales)
        ├── kb-docs        (type: knowledgeBase, parentId: root)
        └── conn-001       (type: connection, fromId → toId)
```

## Canvas Element (schema element)

```ts
// In resource detail or page schema
Canvas.make('workspace')
  .scope((q) => q.where('id', record.id))
  .editable()
  .collaborative()    // Yjs real-time sync
  .persist()          // per-user viewport in localStorage
```

## CanvasField (form field)

```ts
// In resource form — saves to nodes JSON column
CanvasField.make('nodes')
  .editable()
  .collaborative()
  .height(500)
```

## Collaboration

- **Node positions** synced via Yjs Y.Map — all users see drag/drop in real-time
- **Node props** use nested Y.Map — concurrent field edits merge cleanly
- **Presence** — cursor positions and selected nodes via Yjs Awareness
- **Per-user viewport** — zoom/pan stored in localStorage (not shared)
- **Fractional indexing** — CRDT-safe sibling ordering

## Three.js Scene

Isometric 3D view with:
- Department zones (translucent colored platforms)
- Agent nodes (boxes with status LED)
- Knowledge Base nodes (cylinders)
- Connection arrows between nodes
- MapControls (pan/zoom, no rotation)
- Floating HTML info cards via drei `<Html>`
- Toolbar (select, pan, add department/agent/KB, connect, delete)

## Node Types

| Type | Visual | Props |
|---|---|---|
| `department` | Colored platform | name, color, instructions |
| `agent` | Box with LED | name, role, model, systemPrompt, temperature, active |
| `knowledgeBase` | Cylinder | name, description |
| `document` | File icon | title, type, content |
| `connection` | Arrow line | fromId, toId, label, style |

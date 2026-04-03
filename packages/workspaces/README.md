# @rudderjs/workspaces

AI workspace builder for RudderJS — collaborative 3D isometric canvas with departments, agents, knowledge bases, and connections.

## Installation

```bash
pnpm add @rudderjs/workspaces
```

For the 3D canvas (optional peer deps):

```bash
pnpm add three @react-three/fiber @react-three/drei yjs y-websocket y-indexeddb
```

## Setup

```ts
import { Panel } from '@rudderjs/panels'
import { workspaces } from '@rudderjs/workspaces'

export const adminPanel = Panel.make('admin')
  .use(workspaces())
  .resources([...])
```

Publish schema and run migrations:

```bash
pnpm rudder vendor:publish --tag=workspaces-schema
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

## Canvas Element

```ts
// In resource detail or page schema
Canvas.make('workspace')
  .editable()
  .collaborative()    // Yjs real-time sync
  .persist()          // IndexedDB + localStorage persistence
```

## Canvas Controls (Figma-style)

| Input | Action |
|---|---|
| Two-finger trackpad drag | Pan |
| Pinch / ctrl+scroll | Zoom |
| Mouse scroll wheel | Pan |
| Middle-mouse drag | Pan |
| Left click | Select / add node (depends on tool) |
| Delete / Backspace | Delete selected node |

- Custom wheel interceptor distinguishes trackpad scroll (pan) from pinch (zoom) via `ctrlKey`
- MapControls from drei handles zoom math for orthographic cameras
- MapControls automatically disabled during node drag to prevent state corruption

## Grid Snapping

All positions snap to a 10-unit grid (`GRID_SNAP = 10`):

- **Department draw**: start/end points snap, edges align to grid
- **Department drag**: edges snap live during drag (not center)
- **Agent/KB drag**: center snaps live during drag
- **Agent/KB click-to-add**: position snapped on placement

## Department Paint-to-Draw

With the department tool selected:

1. Click on the grid floor — marks start corner (snapped)
2. Drag — blue transparent preview rectangle expands in real-time
3. Release — department created at that position and size
4. Minimum 10x10 units to prevent accidental creates

## Node Drag

All node types use a consistent drag architecture:

- `<group ref>` wraps all children (mesh, LED, label) — entire node moves as one unit
- Window-level `pointermove`/`pointerup` events for smooth tracking even when pointer leaves the mesh
- Raycast to y=0 ground plane for world-space position
- Drag offset computed via y=0 raycast on pointerdown (not mesh surface hit)
- Live grid-snapping during drag

## Three.js Scene

Isometric 3D orthographic view with:

- **Department zones** — translucent colored platforms (1-unit height)
- **Agent nodes** — boxes with green status LED
- **Knowledge Base nodes** — cylinders with accent disk
- **Connection arrows** between nodes
- **Grid floor** — gridHelper, 2000x200 (10-unit cells)
- **Html labels** — fixed screen size (no `distanceFactor`)
- **Toolbar** — select, pan, add department/agent/KB, connect, delete

## Node Types

| Type | Visual | Props |
|---|---|---|
| `department` | Colored platform | name, color, instructions |
| `agent` | Box with LED | name, role, model, systemPrompt, temperature, active |
| `knowledgeBase` | Cylinder | name, description |
| `document` | File icon | title, type, content |
| `connection` | Arrow line | fromId, toId, label, style |

## Collaboration

- **Node positions** synced via Yjs Y.Map — all users see drag/drop in real-time
- **Node props** use nested Y.Map — concurrent field edits merge cleanly
- **Presence** — cursor positions and selected nodes via Yjs Awareness
- **Per-user viewport** — zoom/pan stored in localStorage (not shared)
- **Fractional indexing** — CRDT-safe sibling ordering
- **IndexedDB persistence** — opt-in via `.persist()` on Canvas element
- **WebSocket sync** — opt-in via `.collaborative()` on Canvas element

## Chat Element

```ts
Chat.make('workspace-chat')
  .collaborative()
  .persist()
  .height(400)
```

Renders a chat panel with message input, streaming responses, and conversation history. Uses `@rudderjs/ai` agents for responses, with the orchestrator routing to department agents based on canvas node data.

## Orchestrator

The orchestrator is a special agent that:

1. Receives user messages
2. Analyzes intent and selects relevant departments
3. Calls department agents as tools (`invoke_department`)
4. Synthesizes results into a final response
5. Streams to chat UI via `@rudderjs/broadcast` WebSocket channels

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { workspaces } from './plugin.js'
import { WorkspaceResource } from './resources/WorkspaceResource.js'
import { Canvas } from './canvas/Canvas.js'
import { CanvasField } from './canvas/CanvasField.js'
import { createRootNode, generateNodeId } from './canvas/CanvasNode.js'
import { generateIndex, generateNIndices } from './canvas/fractional-index.js'

// ─── Plugin ───────────────────────────────────────────────

describe('workspaces() plugin', () => {
  it('returns a PanelPlugin with schemas', () => {
    const plugin = workspaces()
    assert.ok(plugin.schemas)
    assert.strictEqual(plugin.schemas.length, 1)
    assert.strictEqual(plugin.schemas[0]!.tag, 'workspaces-schema')
  })

  it('has register and boot hooks', () => {
    const plugin = workspaces()
    assert.ok(typeof plugin.register === 'function')
    assert.ok(typeof plugin.boot === 'function')
  })
})

// ─── Resource ─────────────────────────────────────────────

describe('WorkspaceResource', () => {
  it('has correct static properties', () => {
    assert.strictEqual(WorkspaceResource.label, 'Workspaces')
    assert.strictEqual(WorkspaceResource.icon, 'layout-dashboard')
    assert.strictEqual(WorkspaceResource.navigationGroup, 'AI')
  })

  it('getSlug() derives slug', () => {
    assert.strictEqual(WorkspaceResource.getSlug(), 'workspaces')
  })
})

// ─── Canvas Schema Element ────────────────────────────────

describe('Canvas', () => {
  it('creates with make()', () => {
    const c = Canvas.make('workspace')
    assert.strictEqual(c.getId(), 'workspace')
    assert.strictEqual(c.getType(), 'canvas')
  })

  it('fluent API sets flags', () => {
    const c = Canvas.make('test')
      .editable()
      .collaborative()
      .persist()
    assert.strictEqual(c.isEditable(), true)
    assert.strictEqual(c.isCollaborative(), true)
    assert.strictEqual(c.isPersist(), true)
  })

  it('scope() stores scope function', () => {
    const fn = (q: any) => q.where('id', '123')
    const c = Canvas.make('test').scope(fn)
    assert.strictEqual(c.getScope(), fn)
  })

  it('toMeta() serializes correctly', () => {
    const meta = Canvas.make('ws')
      .editable()
      .collaborative()
      .persist()
      .scope((q: any) => q)
      .toMeta()

    assert.strictEqual(meta.type, 'canvas')
    assert.strictEqual(meta.id, 'ws')
    assert.strictEqual(meta.editable, true)
    assert.strictEqual(meta.collaborative, true)
    assert.strictEqual(meta.persist, true)
    assert.strictEqual(meta.scope, true)
  })

  it('toMeta() scope is undefined when not set', () => {
    const meta = Canvas.make('ws').toMeta()
    assert.strictEqual(meta.scope, undefined)
  })
})

// ─── CanvasField ──────────────────────────────────────────

describe('CanvasField', () => {
  it('creates with make()', () => {
    const f = CanvasField.make('nodes')
    assert.strictEqual(f.getType(), 'canvas')
  })

  it('editable() sets flag', () => {
    const f = CanvasField.make('nodes').editable()
    assert.strictEqual(f.isEditable(), true)
  })

  it('height() sets height', () => {
    const f = CanvasField.make('nodes').height(600)
    assert.strictEqual(f.getHeight(), 600)
  })
})

// ─── Canvas Node ──────────────────────────────────────────

describe('CanvasNode', () => {
  it('createRootNode() returns valid root', () => {
    const root = createRootNode()
    assert.strictEqual(root.id, 'root')
    assert.strictEqual(root.type, 'root')
    assert.strictEqual(root.parentId, '')
  })

  it('generateNodeId() returns unique IDs', () => {
    const a = generateNodeId()
    const b = generateNodeId()
    assert.ok(a.startsWith('node_'))
    assert.notStrictEqual(a, b)
  })
})

// ─── Fractional Indexing ──────────────────────────────────

describe('fractional-index', () => {
  it('generateIndex() with no args returns "a0"', () => {
    assert.strictEqual(generateIndex(), 'a0')
  })

  it('generateIndex(before) returns key after before', () => {
    const idx = generateIndex('a0')
    assert.ok(idx > 'a0', `Expected "${idx}" > "a0"`)
  })

  it('generateNIndices() returns sorted array', () => {
    const indices = generateNIndices(5)
    assert.strictEqual(indices.length, 5)
    for (let i = 1; i < indices.length; i++) {
      assert.ok(indices[i]! > indices[i - 1]!, `Expected "${indices[i]}" > "${indices[i - 1]}"`)
    }
  })

  it('generateIndex(before, after) returns key between', () => {
    const indices = generateNIndices(3)
    const mid = generateIndex(indices[0], indices[2])
    assert.ok(mid > indices[0]!, `Expected "${mid}" > "${indices[0]}"`)
    assert.ok(mid < indices[2]!, `Expected "${mid}" < "${indices[2]}"`)
  })
})

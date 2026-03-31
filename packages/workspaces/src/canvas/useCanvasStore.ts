import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react'
import type { CanvasNode, CanvasNodeBase, CanvasNodeType } from './CanvasNode.js'
import { createRootNode, generateNodeId } from './CanvasNode.js'
import { generateIndex } from './fractional-index.js'

// ─── Types ───────────────────────────────────────────────

export interface CanvasStoreOptions {
  /** WebSocket path (e.g. '/ws-live'). Null = no collaboration. */
  wsPath?: string | null | undefined
  /** Room name for the workspace canvas */
  roomName: string
  /** Initial nodes to populate if room is empty */
  initialNodes?: Record<string, CanvasNode> | undefined
  /** Display name for presence */
  userName?: string | undefined
  /** Cursor color */
  userColor?: string | undefined
}

export interface CanvasStoreReturn {
  /** Reactive map of all nodes */
  nodes: Map<string, CanvasNode>
  /** Whether Yjs is connected and synced */
  ready: boolean
  /** Add a new node */
  addNode(type: CanvasNodeType, parentId: string, props: Record<string, unknown>, position?: { x: number; y: number }): string
  /** Update a node's properties (merges into props) */
  updateNodeProps(id: string, props: Record<string, unknown>): void
  /** Move a node to a new position */
  moveNode(id: string, x: number, y: number): void
  /** Reparent a node under a new parent */
  reparentNode(id: string, newParentId: string): void
  /** Soft-delete a node */
  deleteNode(id: string): void
  /** Get children of a node, sorted by fractional index */
  getChildren(parentId: string): CanvasNode[]
  /** Yjs awareness for presence (cursor, selection) */
  awareness: any | null
}

// ─── Hook ────────────────────────────────────────────────

/**
 * Yjs-backed canvas store. Each node is a nested Y.Map inside a root Y.Map.
 *
 * Room: `workspace:{workspaceId}:canvas`
 * Structure: Y.Map<nodeId, Y.Map<field, value>> where props is also a Y.Map
 */
export function useCanvasStore(opts: CanvasStoreOptions): CanvasStoreReturn {
  const { wsPath, roomName, initialNodes, userName, userColor } = opts
  const isCollab = !!wsPath

  const [ready, setReady] = useState(false)
  const docRef = useRef<any>(null)
  const yModuleRef = useRef<any>(null)
  const providerRef = useRef<any>(null)
  const yMapRef = useRef<any>(null)
  const awarenessRef = useRef<any>(null)

  // Snapshot for useSyncExternalStore
  const [snapshot, setSnapshot] = useState<Map<string, CanvasNode>>(new Map())
  const snapshotRef = useRef(snapshot)

  const updateSnapshot = useCallback(() => {
    const yMap = yMapRef.current
    if (!yMap) return
    const next = new Map<string, CanvasNode>()
    yMap.forEach((_value: any, key: string) => {
      const node = yMapToNode(yMap.get(key))
      if (node && !node.isDeleted) next.set(key, node)
    })
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  // Setup Yjs doc + providers
  useEffect(() => {
    let destroyed = false
    let idbProvider: any = null

    Promise.all([import('yjs'), ...(isCollab ? [import('y-websocket')] : [])]).then(([Y, ws]) => {
      if (destroyed) return

      const doc = new Y.Doc()
      const yMap = doc.getMap('canvas')
      docRef.current = doc
      yModuleRef.current = Y
      yMapRef.current = yMap

      // IndexedDB persistence (fire-and-forget, before WebSocket)
      ;(import('y-indexeddb') as Promise<any>).then(idb => {
        if (!destroyed) idbProvider = new idb.IndexeddbPersistence(roomName, doc)
      }).catch(() => {})

      // WebSocket provider
      if (isCollab && ws) {
        const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${wsProto}://${window.location.host}${wsPath}`
        const provider = new (ws as any).WebsocketProvider(wsUrl, roomName, doc)
        providerRef.current = provider
        awarenessRef.current = provider.awareness

        provider.awareness.setLocalStateField('user', {
          name: userName ?? `User-${Math.floor(Math.random() * 1000)}`,
          color: userColor ?? `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
        })

        provider.once('synced', () => {
          if (destroyed) return
          // Seed initial nodes if room is empty
          if (yMap.size === 0) seedNodes(doc, yMap, initialNodes, Y)
          updateSnapshot()
          setReady(true)
        })
      } else {
        // No collab — populate immediately
        if (yMap.size === 0) seedNodes(doc, yMap, initialNodes, Y)
        updateSnapshot()
        setReady(true)
      }

      // Observe changes
      yMap.observeDeep(() => {
        if (!destroyed) updateSnapshot()
      })
    })

    return () => {
      destroyed = true
      try { providerRef.current?.disconnect?.() } catch { /* ignore */ }
      providerRef.current?.destroy()
      idbProvider?.destroy()
      docRef.current?.destroy()
      docRef.current = null
      yModuleRef.current = null
      yMapRef.current = null
      providerRef.current = null
      awarenessRef.current = null
      setReady(false)
      setSnapshot(new Map())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsPath, roomName])

  // ─── Mutations ─────────────────────────────────────────

  const addNode = useCallback((
    type: CanvasNodeType,
    parentId: string,
    props: Record<string, unknown>,
    position?: { x: number; y: number },
  ): string => {
    const doc = docRef.current
    const yMap = yMapRef.current
    if (!doc || !yMap) return ''

    const id = generateNodeId()
    const siblings = getSiblingIndices(yMap, parentId)
    const index = generateIndex(siblings[siblings.length - 1] ?? '', '')

    const Y = yModuleRef.current
    if (!Y) return ''

    doc.transact(() => {
      const nodeMap = new Y.Map()
      nodeMap.set('id', id)
      nodeMap.set('type', type)
      nodeMap.set('parentId', parentId)
      nodeMap.set('index', index)
      nodeMap.set('x', position?.x ?? 0)
      nodeMap.set('y', position?.y ?? 0)
      nodeMap.set('z', 0)
      nodeMap.set('width', type === 'department' ? 200 : 80)
      nodeMap.set('height', type === 'department' ? 150 : 80)
      nodeMap.set('version', 1)
      nodeMap.set('updatedBy', userName ?? '')
      nodeMap.set('updatedAt', Date.now())

      const propsMap = new Y.Map()
      for (const [k, v] of Object.entries(props)) {
        propsMap.set(k, v)
      }
      nodeMap.set('props', propsMap)

      yMap.set(id, nodeMap)
    })

    return id
  }, [userName])

  const updateNodeProps = useCallback((id: string, props: Record<string, unknown>): void => {
    const doc = docRef.current
    const yMap = yMapRef.current
    if (!doc || !yMap) return

    const nodeMap = yMap.get(id)
    if (!nodeMap) return

    doc.transact(() => {
      const propsMap = nodeMap.get('props')
      if (propsMap && typeof propsMap.set === 'function') {
        for (const [k, v] of Object.entries(props)) {
          propsMap.set(k, v)
        }
      }
      nodeMap.set('version', (nodeMap.get('version') ?? 0) + 1)
      nodeMap.set('updatedBy', userName ?? '')
      nodeMap.set('updatedAt', Date.now())
    })
  }, [userName])

  const moveNode = useCallback((id: string, x: number, y: number): void => {
    const doc = docRef.current
    const yMap = yMapRef.current
    if (!doc || !yMap) return

    const nodeMap = yMap.get(id)
    if (!nodeMap) return

    doc.transact(() => {
      nodeMap.set('x', x)
      nodeMap.set('y', y)
      nodeMap.set('updatedBy', userName ?? '')
      nodeMap.set('updatedAt', Date.now())
    })
  }, [userName])

  const reparentNode = useCallback((id: string, newParentId: string): void => {
    const doc = docRef.current
    const yMap = yMapRef.current
    if (!doc || !yMap) return

    const nodeMap = yMap.get(id)
    if (!nodeMap) return

    const siblings = getSiblingIndices(yMap, newParentId)
    const index = generateIndex(siblings[siblings.length - 1] ?? '', '')

    doc.transact(() => {
      nodeMap.set('parentId', newParentId)
      nodeMap.set('index', index)
      nodeMap.set('updatedBy', userName ?? '')
      nodeMap.set('updatedAt', Date.now())
    })
  }, [userName])

  const deleteNode = useCallback((id: string): void => {
    const doc = docRef.current
    const yMap = yMapRef.current
    if (!doc || !yMap) return

    const nodeMap = yMap.get(id)
    if (!nodeMap) return

    doc.transact(() => {
      nodeMap.set('isDeleted', true)
      nodeMap.set('updatedBy', userName ?? '')
      nodeMap.set('updatedAt', Date.now())
    })
  }, [userName])

  const getChildren = useCallback((parentId: string): CanvasNode[] => {
    const nodes = snapshotRef.current
    const children: CanvasNode[] = []
    for (const node of nodes.values()) {
      if (node.parentId === parentId && !node.isDeleted) children.push(node)
    }
    return children.sort((a, b) => a.index.localeCompare(b.index))
  }, [])

  return {
    nodes: snapshot,
    ready,
    addNode,
    updateNodeProps,
    moveNode,
    reparentNode,
    deleteNode,
    getChildren,
    awareness: awarenessRef.current,
  }
}

// ─── Helpers ─────────────────────────────────────────────

/** Convert a Y.Map node to a plain CanvasNode object */
function yMapToNode(yMap: any): CanvasNode | null {
  if (!yMap || typeof yMap.get !== 'function') return null

  const propsYMap = yMap.get('props')
  const props: Record<string, unknown> = {}
  if (propsYMap && typeof propsYMap.forEach === 'function') {
    propsYMap.forEach((value: unknown, key: string) => { props[key] = value })
  } else if (propsYMap && typeof propsYMap === 'object') {
    Object.assign(props, propsYMap)
  }

  return {
    id: yMap.get('id') ?? '',
    type: yMap.get('type') ?? 'root',
    parentId: yMap.get('parentId') ?? '',
    index: yMap.get('index') ?? 'a0',
    x: yMap.get('x') ?? 0,
    y: yMap.get('y') ?? 0,
    z: yMap.get('z') ?? 0,
    width: yMap.get('width') ?? 0,
    height: yMap.get('height') ?? 0,
    props,
    version: yMap.get('version') ?? 1,
    updatedBy: yMap.get('updatedBy') ?? '',
    updatedAt: yMap.get('updatedAt') ?? 0,
    isDeleted: yMap.get('isDeleted') ?? false,
  } as CanvasNode
}

/** Seed initial nodes into an empty Y.Map */
function seedNodes(
  doc: any,
  yMap: any,
  initialNodes: Record<string, CanvasNode> | undefined,
  Y: any,
): void {
  const nodes = initialNodes ?? { root: createRootNode() }

  doc.transact(() => {
    for (const [id, node] of Object.entries(nodes)) {
      const nodeMap = new Y.Map()
      nodeMap.set('id', node.id)
      nodeMap.set('type', node.type)
      nodeMap.set('parentId', node.parentId)
      nodeMap.set('index', node.index)
      nodeMap.set('x', node.x)
      nodeMap.set('y', node.y)
      nodeMap.set('z', node.z)
      nodeMap.set('width', node.width)
      nodeMap.set('height', node.height)
      nodeMap.set('version', node.version)
      nodeMap.set('updatedBy', node.updatedBy)
      nodeMap.set('updatedAt', node.updatedAt)

      const propsMap = new Y.Map()
      for (const [k, v] of Object.entries(node.props)) {
        propsMap.set(k, v)
      }
      nodeMap.set('props', propsMap)

      yMap.set(id, nodeMap)
    }
  })
}

/** Get sorted fractional indices of siblings under a parent */
function getSiblingIndices(yMap: any, parentId: string): string[] {
  const indices: string[] = []
  yMap.forEach((nodeMap: any) => {
    if (nodeMap.get?.('parentId') === parentId && !nodeMap.get?.('isDeleted')) {
      indices.push(nodeMap.get('index') ?? 'a0')
    }
  })
  return indices.sort()
}

import { useCallback, useEffect, useRef } from 'react'
import { MapControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import type { CanvasNode, DepartmentNode, AgentNode, KnowledgeBaseNode, ConnectionNode } from '../../../src/canvas/CanvasNode.js'
import type { CanvasStoreReturn } from '../../../src/canvas/useCanvasStore.js'
import type { UseCanvasViewportReturn } from '../../../src/canvas/useCanvasViewport.js'
import type { CanvasTool } from './CanvasToolbar.js'
import { DepartmentZone } from './DepartmentZone.js'
import { AgentNode as AgentNodeComponent } from './AgentNode.js'
import { KBNode } from './KBNode.js'
import { ConnectionLine } from './ConnectionLine.js'
import { IsometricGrid } from './IsometricGrid.js'
import { PresenceCursors } from './PresenceCursors.js'
import { toolToNodeType } from './CanvasToolbar.js'

interface CanvasSceneProps {
  store: CanvasStoreReturn
  viewport: UseCanvasViewportReturn
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  activeTool: CanvasTool
  editable: boolean
}

/** Three.js scene contents: camera, lights, controls, and all node renderers */
export function CanvasScene({
  store,
  viewport,
  selectedNodeId,
  onSelectNode,
  activeTool,
  editable,
}: CanvasSceneProps) {
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)

  // Isometric camera setup
  useEffect(() => {
    const cam = camera as OrthographicCamera
    // Position camera for isometric view (45° angle)
    cam.position.set(200, 200, 200)
    cam.lookAt(0, 0, 0)
    cam.zoom = viewport.viewport.zoom
    cam.updateProjectionMatrix()
  }, [camera, viewport.viewport.zoom])

  // Sync viewport on controls change
  const handleControlsChange = useCallback(() => {
    const cam = camera as OrthographicCamera
    viewport.setViewport({
      zoom: cam.zoom,
      panX: cam.position.x,
      panY: cam.position.z,
    })
  }, [camera, viewport])

  // Click on empty space to deselect or add node
  const handleBackgroundClick = useCallback((e: any) => {
    const nodeType = toolToNodeType(activeTool)
    if (nodeType && editable) {
      // Add node at click position
      const defaultProps = getDefaultProps(nodeType)
      store.addNode(nodeType, 'root', defaultProps, { x: e.point.x, y: e.point.z })
      return
    }
    onSelectNode(null)
  }, [activeTool, editable, store, onSelectNode])

  // Update awareness cursor position
  const handlePointerMove = useCallback((e: any) => {
    if (store.awareness) {
      store.awareness.setLocalStateField('cursor', {
        x: e.point.x,
        y: e.point.z,
      })
    }
  }, [store.awareness])

  // Handle delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId && editable) {
        store.deleteNode(selectedNodeId)
        onSelectNode(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, editable, store, onSelectNode])

  // Node event handlers
  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    store.moveNode(id, x, y)
  }, [store])

  const handleSelect = useCallback((id: string) => {
    if (activeTool === 'delete' && editable) {
      store.deleteNode(id)
    } else {
      onSelectNode(id)
    }
  }, [activeTool, editable, store, onSelectNode])

  // Categorize nodes
  const departments: DepartmentNode[] = []
  const agents: AgentNode[] = []
  const kbs: KnowledgeBaseNode[] = []
  const connections: ConnectionNode[] = []

  for (const node of store.nodes.values()) {
    switch (node.type) {
      case 'department': departments.push(node as DepartmentNode); break
      case 'agent': agents.push(node as AgentNode); break
      case 'knowledgeBase': kbs.push(node as KnowledgeBaseNode); break
      case 'connection': connections.push(node as ConnectionNode); break
    }
  }

  return (
    <>
      {/* Camera controls — pan + zoom, no rotation */}
      <MapControls
        ref={controlsRef}
        enableRotate={false}
        onChange={handleControlsChange}
        enabled={activeTool === 'select' || activeTool === 'pan'}
      />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, 150, 100]} intensity={0.8} castShadow />

      {/* Background click plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1, 0]}
        onClick={handleBackgroundClick}
        onPointerMove={handlePointerMove}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Grid */}
      <IsometricGrid />

      {/* Department zones (render first — they're the base layer) */}
      {departments.map(node => (
        <DepartmentZone
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={handleSelect}
          onDragEnd={handleDragEnd}
          editable={editable}
        />
      ))}

      {/* Agent nodes */}
      {agents.map(node => (
        <AgentNodeComponent
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={handleSelect}
          onDragEnd={handleDragEnd}
          editable={editable}
        />
      ))}

      {/* Knowledge Base nodes */}
      {kbs.map(node => (
        <KBNode
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={handleSelect}
          onDragEnd={handleDragEnd}
          editable={editable}
        />
      ))}

      {/* Connection lines */}
      {connections.map(node => (
        <ConnectionLine
          key={node.id}
          node={node}
          nodes={store.nodes}
          selected={selectedNodeId === node.id}
          onSelect={handleSelect}
        />
      ))}

      {/* Presence cursors */}
      <PresenceCursors awareness={store.awareness} />
    </>
  )
}

function getDefaultProps(type: string): Record<string, unknown> {
  switch (type) {
    case 'department': return { name: 'New Department', color: '#3b82f6', instructions: '' }
    case 'agent': return { name: 'New Agent', role: '', systemPrompt: '', model: 'anthropic/claude-sonnet-4-5', active: true }
    case 'knowledgeBase': return { name: 'New Knowledge Base', description: '' }
    default: return {}
  }
}

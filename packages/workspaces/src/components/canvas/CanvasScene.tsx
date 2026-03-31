// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useCallback, useEffect, useRef } from 'react'
import { MapControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrthographicCamera } from 'three'
import type { CanvasNode, DepartmentNode, AgentNode, KnowledgeBaseNode, ConnectionNode } from '../../canvas/CanvasNode.js'
import type { CanvasStoreReturn } from '../../canvas/useCanvasStore.js'
import type { UseCanvasViewportReturn } from '../../canvas/useCanvasViewport.js'
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
  const { camera, gl } = useThree()
  const controlsRef = useRef<any>(null)

  // Isometric camera setup
  useEffect(() => {
    const cam = camera as OrthographicCamera
    cam.position.set(200, 200, 200)
    cam.lookAt(0, 0, 0)
    cam.zoom = viewport.viewport.zoom
    cam.updateProjectionMatrix()
  }, [camera, viewport.viewport.zoom])

  // Intercept wheel events for Figma-style controls:
  // - Regular scroll (trackpad two-finger) → pan via MapControls
  // - ctrlKey scroll (pinch / ctrl+wheel) → zoom via MapControls
  useEffect(() => {
    const canvas = gl.domElement
    const handleWheel = (e: WheelEvent) => {
      if (!controlsRef.current) return
      // ctrlKey = pinch or ctrl+scroll → let MapControls zoom
      if (e.ctrlKey || e.metaKey) return

      // Regular scroll → convert to pan
      e.preventDefault()
      e.stopImmediatePropagation()

      const cam = camera as OrthographicCamera
      const controls = controlsRef.current

      // Pan in screen space using camera's local axes
      const factor = 1 / cam.zoom
      const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
      const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1)

      const offset = new Vector3()
      offset.addScaledVector(right, e.deltaX * factor)
      offset.addScaledVector(up, -e.deltaY * factor)

      cam.position.add(offset)
      controls.target.add(offset)
      controls.update()

      viewport.setViewport({
        zoom: cam.zoom,
        panX: cam.position.x,
        panY: cam.position.z,
      })
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => canvas.removeEventListener('wheel', handleWheel, { capture: true })
  }, [camera, gl, viewport])

  // Sync viewport on MapControls change (zoom via pinch)
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

  // Disable MapControls during node drag so pointer events don't corrupt its state
  const handleDragStart = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = false
  }, [])

  // Node event handlers
  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    if (controlsRef.current) controlsRef.current.enabled = true
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
      {/* MapControls: right-drag = pan, pinch/ctrl+scroll = zoom */}
      <MapControls
        ref={controlsRef}
        enableRotate={false}
        enableZoom={true}
        enablePan={true}
        screenSpacePanning={true}
        minZoom={0.3}
        maxZoom={5}
        onChange={handleControlsChange}
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

      {/* Department zones */}
      {departments.map(node => (
        <DepartmentZone
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={handleSelect}
          onDragStart={handleDragStart}
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
          onDragStart={handleDragStart}
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
          onDragStart={handleDragStart}
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

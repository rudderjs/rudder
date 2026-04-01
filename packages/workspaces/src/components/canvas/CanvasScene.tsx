// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useCallback, useEffect, useRef, useState } from 'react'
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

const GRID_SNAP = 10

/** Snap a value to the nearest grid unit */
function snap(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP
}

interface CanvasSceneProps {
  store: CanvasStoreReturn
  viewport: UseCanvasViewportReturn
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  activeTool: CanvasTool
  editable: boolean
  camPos: { x: number; y: number; z: number }
  onCamPosChange: (pos: { x: number; y: number; z: number }) => void
}

/** Three.js scene contents: camera, lights, controls, and all node renderers */
export function CanvasScene({
  store,
  viewport,
  selectedNodeId,
  onSelectNode,
  activeTool,
  editable,
  camPos,
  onCamPosChange,
}: CanvasSceneProps) {
  const { camera, gl, raycaster } = useThree()
  const controlsRef = useRef<any>(null)

  // Department paint-to-draw state
  const [drawingDept, setDrawingDept] = useState<{ startX: number; startZ: number; endX: number; endZ: number } | null>(null)
  const drawingRef = useRef(false)

  // Isometric camera setup
  useEffect(() => {
    const cam = camera as OrthographicCamera
    cam.position.set(camPos.x, camPos.y, camPos.z)
    cam.lookAt(0, 0, 0)
    cam.zoom = viewport.viewport.zoom
    cam.updateProjectionMatrix()
  }, [camera, viewport.viewport.zoom, camPos])

  // Intercept wheel events for Figma-style controls
  useEffect(() => {
    const canvas = gl.domElement
    const handleWheel = (e: WheelEvent) => {
      if (!controlsRef.current) return
      if (e.ctrlKey || e.metaKey) return

      e.preventDefault()
      e.stopImmediatePropagation()

      const cam = camera as OrthographicCamera
      const controls = controlsRef.current

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

  // ─── Raycast helper: pointer → y=0 ground plane ───
  const raycastGround = useCallback((e: PointerEvent): { x: number; z: number } | null => {
    const canvas = gl.domElement
    const rect = canvas.getBoundingClientRect()
    const mouse = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    }
    raycaster.setFromCamera(mouse, camera)
    const t = -raycaster.ray.origin.y / raycaster.ray.direction.y
    if (t <= 0) return null
    return {
      x: raycaster.ray.origin.x + raycaster.ray.direction.x * t,
      z: raycaster.ray.origin.z + raycaster.ray.direction.z * t,
    }
  }, [gl, raycaster, camera])

  // ─── Department paint-to-draw (window-level for smooth drawing) ───
  useEffect(() => {
    if (activeTool !== 'add-department' || !editable) return

    const canvas = gl.domElement

    const handlePointerDown = (e: PointerEvent) => {
      // Only left click
      if (e.button !== 0) return
      const hit = raycastGround(e)
      if (!hit) return

      const sx = snap(hit.x)
      const sz = snap(hit.z)
      drawingRef.current = true
      setDrawingDept({ startX: sx, startZ: sz, endX: sx, endZ: sz })
      if (controlsRef.current) controlsRef.current.enabled = false
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!drawingRef.current) return
      const hit = raycastGround(e)
      if (!hit) return
      setDrawingDept(prev => prev ? { ...prev, endX: snap(hit.x), endZ: snap(hit.z) } : null)
    }

    const handlePointerUp = () => {
      if (!drawingRef.current) return
      drawingRef.current = false
      if (controlsRef.current) controlsRef.current.enabled = true

      setDrawingDept(prev => {
        if (!prev) return null
        const x = Math.min(prev.startX, prev.endX)
        const z = Math.min(prev.startZ, prev.endZ)
        const w = Math.abs(prev.endX - prev.startX)
        const h = Math.abs(prev.endZ - prev.startZ)

        // Minimum size to avoid accidental click-creates
        if (w >= GRID_SNAP && h >= GRID_SNAP) {
          const cx = x + w / 2
          const cz = z + h / 2
          store.addNode('department', 'root', {
            name: 'New Department',
            color: '#3b82f6',
            instructions: '',
          }, { x: cx, y: cz }, { width: w, height: h })
        }
        return null
      })
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [activeTool, editable, gl, raycastGround, store])

  // ─── Background click — only for select tool (deselect) or non-department add tools ───
  const handleBackgroundClick = useCallback((e: any) => {
    // Department tool uses its own DOM-level handler above
    if (activeTool === 'add-department') return

    e.stopPropagation()

    const nodeType = toolToNodeType(activeTool)
    if (nodeType && editable) {
      const defaultProps = getDefaultProps(nodeType)
      store.addNode(nodeType, 'root', defaultProps, { x: snap(e.point.x), y: snap(e.point.z) })
      return
    }

    // Select tool — deselect
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

  // Disable MapControls during node drag
  const handleDragStart = useCallback(() => {
    if (controlsRef.current) controlsRef.current.enabled = false
  }, [])

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    if (controlsRef.current) controlsRef.current.enabled = true
    store.moveNode(id, snap(x), snap(y))
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

  // Drawing preview rectangle
  const deptPreview = drawingDept ? {
    x: Math.min(drawingDept.startX, drawingDept.endX),
    z: Math.min(drawingDept.startZ, drawingDept.endZ),
    w: Math.abs(drawingDept.endX - drawingDept.startX),
    h: Math.abs(drawingDept.endZ - drawingDept.startZ),
  } : null

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

      {/* Department drawing preview */}
      {deptPreview && deptPreview.w > 0 && deptPreview.h > 0 && (
        <mesh
          position={[deptPreview.x + deptPreview.w / 2, 0.5, deptPreview.z + deptPreview.h / 2]}
        >
          <boxGeometry args={[deptPreview.w, 1, deptPreview.h]} />
          <meshStandardMaterial color="#3b82f6" transparent opacity={0.3} />
        </mesh>
      )}

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

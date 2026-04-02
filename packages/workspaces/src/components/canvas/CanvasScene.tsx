// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useCallback, useEffect, useRef, useState } from 'react'
import { MapControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Vector3, MOUSE, Raycaster, Vector2 } from 'three'
import type { OrthographicCamera } from 'three'
import type { CanvasNode, DepartmentNode, AgentNode, KnowledgeBaseNode, ConnectionNode, HandlePosition } from '../../canvas/CanvasNode.js'
import { findClosestHandle, getHandleWorldPos, getAllHandles } from '../../canvas/CanvasNode.js'
import type { CanvasStoreReturn } from '../../canvas/useCanvasStore.js'
import type { UseCanvasViewportReturn } from '../../canvas/useCanvasViewport.js'
import type { CanvasTool } from './CanvasToolbar.js'
import { DepartmentZone } from './DepartmentZone.js'
import { AgentNode as AgentNodeComponent } from './AgentNode.js'
import { KBNode } from './KBNode.js'
import { ConnectionLine, ConnectionPreview } from './ConnectionLine.js'
import { IsometricGrid } from './IsometricGrid.js'
import { PresenceCursors } from './PresenceCursors.js'
import { toolToNodeType } from './CanvasToolbar.js'

const GRID_SNAP = 10

/** Check if a node is inside a department's bounds */
function isNodeInsideDept(child: CanvasNode, dept: CanvasNode): boolean {
  if (dept.type !== 'department') return false
  const hw = (dept.width || 200) / 2
  const hh = (dept.height || 150) / 2
  return Math.abs(child.x - dept.x) <= hw && Math.abs(child.y - dept.y) <= hh
}

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
  shadowCfg?: { x: number; z: number; scaleX: number; scaleZ: number; radius: number; opacity: number } | undefined
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
  shadowCfg,
}: CanvasSceneProps) {
  const { camera, gl, raycaster } = useThree()
  const controlsRef = useRef<any>(null)

  // Connection tool state
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [connectSourceHandle, setConnectSourceHandle] = useState<HandlePosition>('right')
  const [cursorPos, setCursorPos] = useState<{ x: number; z: number } | null>(null)
  const [snapTargetHandle, setSnapTargetHandle] = useState<HandlePosition | null>(null)
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null)

  // Department paint-to-draw state
  const [drawingDept, setDrawingDept] = useState<{ startX: number; startZ: number; endX: number; endZ: number } | null>(null)
  const drawingDeptRef = useRef(drawingDept)
  drawingDeptRef.current = drawingDept
  const drawingRef = useRef(false)

  // Isometric camera setup — only resets on camPos change (debug sliders) or mount
  useEffect(() => {
    const cam = camera as OrthographicCamera
    cam.position.set(camPos.x, camPos.y, camPos.z)
    cam.lookAt(0, 0, 0)
    cam.updateProjectionMatrix()
    // Also reset MapControls target to origin when camera angle changes
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    }
  }, [camera, camPos])

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

      // Read current drawing state and create node (outside state updater to avoid React strict-mode double-fire)
      const prev = drawingDeptRef.current
      setDrawingDept(null)
      if (!prev) return

      const x = Math.min(prev.startX, prev.endX)
      const z = Math.min(prev.startZ, prev.endZ)
      const w = Math.abs(prev.endX - prev.startX)
      const h = Math.abs(prev.endZ - prev.startZ)

      if (w >= GRID_SNAP && h >= GRID_SNAP) {
        const cx = x + w / 2
        const cz = z + h / 2
        store.addNode('department', 'root', {
          name: 'New Department',
          color: '#3b82f6',
          instructions: '',
        }, { x: cx, y: cz }, { width: w, height: h })
      }
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

  // ─── Connection tool — click-drag-release (paint a line on the floor) ───
  const connectingRef = useRef(false)
  const connectSourceRef = useRef(connectSourceId)
  connectSourceRef.current = connectSourceId
  const connectSourceHandleRef = useRef(connectSourceHandle)
  connectSourceHandleRef.current = connectSourceHandle

  /** Find nearest node to a ground-plane hit point.
   *  Prioritizes handle proximity — clicking a department handle selects the department
   *  even when a child agent is nearby inside. */
  const findNearestNode = useCallback((hitX: number, hitZ: number): string | null => {
    const HANDLE_SNAP_DIST = 12  // prioritize if click is near a handle

    // First pass: check if click is very close to any node's handle
    let handleNode: string | null = null
    let handleDist = Infinity
    for (const [id, node] of store.nodes) {
      if (node.type === 'connection' || node.type === 'root') continue
      const handles = getAllHandles(node)
      for (const pos of Object.values(handles)) {
        const d = Math.abs(hitX - pos.x) + Math.abs(hitZ - pos.z)
        if (d < HANDLE_SNAP_DIST && d < handleDist) {
          handleNode = id
          handleDist = d
        }
      }
    }
    if (handleNode) return handleNode

    // Second pass: standard proximity (prefer small nodes over departments)
    let closest: string | null = null
    let closestDist = Infinity

    for (const [id, node] of store.nodes) {
      if (node.type === 'connection' || node.type === 'root') continue
      const dx = hitX - node.x
      const dz = hitZ - node.y
      if (node.type === 'department') {
        const hw = (node.width || 200) / 2
        const hh = (node.height || 150) / 2
        if (Math.abs(dx) <= hw && Math.abs(dz) <= hh) {
          const dist = Math.abs(dx) + Math.abs(dz)
          if (dist < closestDist) { closest = id; closestDist = dist }
        }
      } else {
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < 20 && dist < closestDist) { closest = id; closestDist = dist }
      }
    }
    return closest
  }, [store.nodes])

  useEffect(() => {
    if (activeTool !== 'connect' || !editable) return

    const canvas = gl.domElement

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const hit = raycastGround(e)
      if (!hit) return

      const nodeId = findNearestNode(hit.x, hit.z)
      if (!nodeId) return

      // Find closest handle on the source node
      const sourceNode = store.nodes.get(nodeId)
      const handle = sourceNode ? findClosestHandle(sourceNode, hit.x, hit.z) : 'right'
      const handlePos = sourceNode ? getHandleWorldPos(sourceNode, handle) : { x: hit.x, z: hit.z }

      connectingRef.current = true
      setConnectSourceId(nodeId)
      setConnectSourceHandle(handle)
      setCursorPos({ x: handlePos.x, z: handlePos.z })
      if (controlsRef.current) controlsRef.current.enabled = false
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!connectingRef.current) return
      const hit = raycastGround(e)
      if (!hit) return

      // Check if cursor is near a target node — snap to its closest handle
      const nearNodeId = findNearestNode(hit.x, hit.z)
      if (nearNodeId && nearNodeId !== connectSourceRef.current) {
        const nearNode = store.nodes.get(nearNodeId)
        if (nearNode) {
          const handle = findClosestHandle(nearNode, hit.x, hit.z)
          const hp = getHandleWorldPos(nearNode, handle)
          setCursorPos({ x: hp.x, z: hp.z })
          setSnapTargetHandle(handle)
          setSnapTargetId(nearNodeId)
          return
        }
      }
      setSnapTargetHandle(null)
      setSnapTargetId(null)
      setCursorPos({ x: hit.x, z: hit.z })
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!connectingRef.current) return
      connectingRef.current = false
      if (controlsRef.current) controlsRef.current.enabled = true

      const hit = raycastGround(e)
      const sourceId = connectSourceRef.current

      if (hit && sourceId) {
        const targetId = findNearestNode(hit.x, hit.z)
        if (targetId && targetId !== sourceId) {
          const targetNode = store.nodes.get(targetId)
          const toHandle = targetNode ? findClosestHandle(targetNode, hit.x, hit.z) : 'left'
          store.addNode('connection', 'root', {
            fromId: sourceId,
            fromHandle: connectSourceHandleRef.current,
            toId: targetId,
            toHandle: toHandle,
            label: '',
            style: 'solid',
          })
        }
      }

      setConnectSourceId(null)
      setCursorPos(null)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [activeTool, editable, gl, raycastGround, findNearestNode, store])

  // ─── Background click — only for select tool (deselect) or non-department add tools ───
  const handleBackgroundClick = useCallback((e: any) => {
    // Department tool uses its own DOM-level handler above
    if (activeTool === 'add-department') return

    e.stopPropagation()

    // Cancel connection on background click
    if (connectSourceId) {
      setConnectSourceId(null)
      setCursorPos(null)
      return
    }

    const nodeType = toolToNodeType(activeTool)
    if (nodeType && editable) {
      const defaultProps = getDefaultProps(nodeType)
      store.addNode(nodeType, 'root', defaultProps, { x: snap(e.point.x), y: snap(e.point.z) })
      return
    }

    // Select tool — deselect
    onSelectNode(null)
  }, [activeTool, editable, store, onSelectNode, connectSourceId])

  // Update awareness cursor position + connection preview
  const handlePointerMove = useCallback((e: any) => {
    if (store.awareness) {
      store.awareness.setLocalStateField('cursor', {
        x: e.point.x,
        y: e.point.z,
      })
    }
    // Track cursor for connection preview line
    if (connectSourceId) {
      setCursorPos({ x: e.point.x, z: e.point.z })
    }
  }, [store.awareness, connectSourceId])

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

  // Live drag position for connection updates
  const [dragOverride, setDragOverride] = useState<{ id: string; x: number; z: number } | null>(null)

  // Disable MapControls during node drag — but not for connect/delete tools
  const handleDragStart = useCallback(() => {
    if (activeTool === 'connect' || activeTool === 'delete') return
    if (controlsRef.current) controlsRef.current.enabled = false
  }, [activeTool])

  const handleDragMove = useCallback((id: string, x: number, z: number) => {
    setDragOverride({ id, x, z })
  }, [])

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    if (controlsRef.current) controlsRef.current.enabled = true
    setDragOverride(null)
    // For departments: snap edges (top-left corner), then convert back to center
    const node = store.nodes.get(id)
    if (node && (node.type === 'department')) {
      const w = node.width || 200
      const h = node.height || 150
      const left = snap(x - w / 2)
      const top = snap(y - h / 2)
      store.moveNode(id, left + w / 2, top + h / 2)
    } else {
      store.moveNode(id, snap(x), snap(y))
    }
  }, [store])

  const handleSelect = useCallback((id: string) => {
    if (activeTool === 'delete' && editable) {
      store.deleteNode(id)
    } else if (activeTool === 'connect') {
      // Handled at DOM level — do nothing here
    } else {
      onSelectNode(id)
    }
  }, [activeTool, editable, store, onSelectNode])

  // Only allow dragging with select tool
  const canDrag = editable && (activeTool === 'select' || activeTool === 'pan')

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
      {/* MapControls: pinch/ctrl+scroll = zoom, right-drag = pan.
          Left button removed entirely so it doesn't track gestures that corrupt internal state. */}
      <MapControls
        ref={controlsRef}
        enableRotate={false}
        enableZoom={true}
        enablePan={true}
        screenSpacePanning={true}
        mouseButtons={{ MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
        minZoom={0.3}
        maxZoom={15}
        onChange={handleControlsChange}
      />

      {/* Lighting — from top-left of isometric view so shadow falls bottom-right */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[-80, 200, -80]} intensity={0.8} castShadow />

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

      {/* Department drawing preview — show from first click, min 1 unit so it's always visible */}
      {deptPreview && (
        <mesh
          position={[deptPreview.x + deptPreview.w / 2, 0.05, deptPreview.z + deptPreview.h / 2]}
        >
          <boxGeometry args={[Math.max(deptPreview.w, 1), 0.1, Math.max(deptPreview.h, 1)]} />
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
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          editable={canDrag}
          activeTool={activeTool}
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
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          editable={canDrag}
          activeTool={activeTool}
          shadowCfg={shadowCfg}
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
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          editable={canDrag}
          activeTool={activeTool}
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
          dragOverride={dragOverride}
        />
      ))}

      {/* Handle dots — visible when connect tool is active */}
      {activeTool === 'connect' && editable && (() => {
        const dots: JSX.Element[] = []
        for (const [id, node] of store.nodes) {
          if (node.type === 'connection' || node.type === 'root') continue
          const handles = getAllHandles(node)
          for (const [name, pos] of Object.entries(handles)) {
            dots.push(
              <mesh key={`${id}-${name}`} position={[pos.x, 1.2, pos.z]}>
                <sphereGeometry args={[1.2, 10, 10]} />
                <meshStandardMaterial color="#6366f1" transparent opacity={0.6} />
              </mesh>
            )
          }
        }
        return dots
      })()}

      {/* Connection preview — L-shaped from handle to cursor */}
      {connectSourceId && cursorPos && (() => {
        const sourceNode = store.nodes.get(connectSourceId)
        if (!sourceNode) return null
        const hp = getHandleWorldPos(sourceNode, connectSourceHandle)
        // Detect inline (one node inside the other) for inverted stems
        let inline = false
        if (snapTargetId) {
          const targetNode = store.nodes.get(snapTargetId)
          if (targetNode) {
            inline = isNodeInsideDept(sourceNode, targetNode) || isNodeInsideDept(targetNode, sourceNode)
          }
        }
        return (
          <ConnectionPreview
            fromX={hp.x} fromZ={hp.z}
            toX={cursorPos.x} toZ={cursorPos.z}
            fromHandle={connectSourceHandle}
            toHandle={snapTargetHandle}
            inline={inline}
            color="#6366f1"
          />
        )
      })()}

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

// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Shape, ExtrudeGeometry, ShapeGeometry } from 'three'
import type { Group } from 'three'
import type { AgentNode as AgentNodeType } from '../../canvas/CanvasNode.js'

interface ShadowCfg {
  x: number; z: number; scaleX: number; scaleZ: number; radius: number; opacity: number
}

interface AgentNodeProps {
  node: AgentNodeType
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: () => void
  onDragMove: (id: string, x: number, z: number) => void
  onDragEnd: (id: string, x: number, y: number) => void
  editable: boolean
  activeTool: string
  shadowCfg?: ShadowCfg | undefined
  elevation?: number | undefined
}

// ─── SVG → Three.js Shape conversion ─────────────────────────
// SVG viewBox: 0 0 220 220. Scale = 10/220. Center X at 110. Flip Y.
// threeX = (svgX - 110) / 22,  threeY = (220 - svgY) / 22

const S = 1 / 22 // scale factor

/** Convert SVG point to Three.js Shape coords */
function sv(svgX: number, svgY: number): [number, number] {
  return [(svgX - 110) * S, (220 - svgY) * S]
}

/** Person body shape — shoulders, neck, torso base */
function createBodyShape(): Shape {
  const s = new Shape()

  // Bottom-left corner (SVG: 20, 220)
  s.moveTo(...sv(20, 220))

  // Left edge up to shoulder start (SVG: 20, 180.39)
  s.lineTo(...sv(20, 180.39))

  // Left shoulder curve up to neck
  // SVG: c 0,-46.6  27.86,-84.69  63.01,-87.39
  // From (20, 180.39) → CP1(20, 133.79) CP2(47.86, 95.7) End(83.01, 93)
  s.bezierCurveTo(...sv(20, 133.79), ...sv(47.86, 95.7), ...sv(83.01, 93))

  // Neck curves — simplified from 7 tiny SVG beziers into 2 smooth curves
  // Left neck to center dip (lowest at ~SVG 103.57, 101.23)
  s.bezierCurveTo(...sv(85, 94.4), ...sv(96, 100.8), ...sv(103.57, 101.23))

  // Center dip to right neck (back up to SVG 137, 93)
  s.bezierCurveTo(...sv(112.7, 101.7), ...sv(129.6, 97.3), ...sv(137, 93))

  // Right shoulder curve down
  // SVG: c 35.15,2.7  63.01,40.79  63.01,87.39
  // From (137, 93) → CP1(172.15, 95.7) CP2(200, 133.79) End(200, 180.39)
  s.bezierCurveTo(...sv(172.15, 95.7), ...sv(200, 133.79), ...sv(200, 180.39))

  // Right edge down + bottom
  s.lineTo(...sv(200, 220))
  s.closePath()
  return s
}

/** Person head — circle at SVG (110, 52) radius 50 */
function createHeadShape(): Shape {
  const [cx, cy] = sv(110, 52)
  const r = 50 * S  // 2.27
  const s = new Shape()
  s.absarc(cx, cy, r, 0, Math.PI * 2, false)
  s.closePath()
  return s
}

const EXTRUDE_DEPTH = 1.5
const EXTRUDE_SETTINGS = {
  depth: EXTRUDE_DEPTH,
  curveSegments: 64,
  bevelEnabled: true,
  bevelThickness: 0.15,
  bevelSize: 0.15,
  bevelSegments: 3,
}

/** Sample smooth points from a Shape for outline rendering */
function shapeToOutline(shape: Shape, z: number, divisions = 64): [number, number, number][] {
  const pts = shape.getPoints(divisions)
  // Close the loop
  if (pts.length > 0) pts.push(pts[0])
  return pts.map(p => [p.x, p.y, z] as [number, number, number])
}

/** 3D person silhouette representing an AI agent (Isoflow style) */
export function AgentNode({ node, selected, onSelect, onDragStart, onDragMove, onDragEnd, editable, activeTool, shadowCfg, elevation = 0 }: AgentNodeProps) {
  const groupRef = useRef<Group>(null)
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, z: 0 })
  const [hovered, setHovered] = useState(false)
  const { gl, raycaster, camera } = useThree()

  const size = 10
  const active = node.props.active !== false

  // Build extruded geometries + outline points + flat shadow shapes (once)
  const geoms = useMemo(() => {
    const bodyShape = createBodyShape()
    const headShape = createHeadShape()
    const bg = new ExtrudeGeometry(bodyShape, EXTRUDE_SETTINGS)
    const hg = new ExtrudeGeometry(headShape, EXTRUDE_SETTINGS)
    // Front face outlines
    const bodyOutline = shapeToOutline(bodyShape, 0)
    const headOutline = shapeToOutline(headShape, 0)
    // Back face outlines
    const bodyOutlineBack = shapeToOutline(bodyShape, EXTRUDE_DEPTH)
    const headOutlineBack = shapeToOutline(headShape, EXTRUDE_DEPTH)
    // Flat shadow shapes (same silhouette, no extrusion)
    const bodyShadow = new ShapeGeometry(bodyShape, 64)
    const headShadow = new ShapeGeometry(headShape, 64)
    return { body: bg, head: hg, bodyOutline, headOutline, bodyOutlineBack, headOutlineBack, bodyShadow, headShadow }
  }, [])

  // Dispose geometries on unmount
  useEffect(() => () => {
    geoms.body.dispose()
    geoms.head.dispose()
    geoms.bodyShadow.dispose()
    geoms.headShadow.dispose()
  }, [geoms])

  // Window-level pointer handlers for smooth drag
  useEffect(() => {
    const canvas = gl.domElement

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragging.current || !groupRef.current) return
      const rect = canvas.getBoundingClientRect()
      const mouse = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      }
      raycaster.setFromCamera(mouse, camera)
      const t = -raycaster.ray.origin.y / raycaster.ray.direction.y
      if (t > 0) {
        const worldX = raycaster.ray.origin.x + raycaster.ray.direction.x * t
        const worldZ = raycaster.ray.origin.z + raycaster.ray.direction.z * t
        groupRef.current.position.x = Math.round((worldX - dragOffset.current.x - size / 2) / 10) * 10 + size / 2
        groupRef.current.position.z = Math.round((worldZ - dragOffset.current.z - size / 2) / 10) * 10 + size / 2
        onDragMove(node.id, groupRef.current.position.x - size / 2, groupRef.current.position.z - size / 2)
      }
    }

    const handlePointerUp = () => {
      if (!dragging.current) return
      dragging.current = false
      canvas.style.cursor = ''
      if (groupRef.current) {
        onDragEnd(node.id, groupRef.current.position.x - size / 2, groupRef.current.position.z - size / 2)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [gl, raycaster, camera, node.id, onDragEnd])

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onSelect(node.id)
    if (!editable || activeTool === 'connect' || activeTool === 'delete') return
    // Raycast to y=0 ground plane for consistent offset with drag move
    const ray = e.ray ?? raycaster.ray
    const t = -ray.origin.y / ray.direction.y
    const groundX = ray.origin.x + ray.direction.x * t
    const groundZ = ray.origin.z + ray.direction.z * t
    dragging.current = true
    dragOffset.current = { x: groundX - node.x, z: groundZ - node.y }
    gl.domElement.style.cursor = 'grabbing'
    onDragStart()
  }, [editable, activeTool, node.id, node.x, node.y, onSelect, onDragStart, gl, raycaster])

  const handlePointerEnter = useCallback(() => {
    setHovered(true)
    gl.domElement.style.cursor = editable ? 'grab' : 'pointer'
  }, [editable, gl])

  const handlePointerLeave = useCallback(() => {
    setHovered(false)
    if (!dragging.current) gl.domElement.style.cursor = ''
  }, [gl])

  const meshColor = selected ? '#c7d2fe' : hovered ? '#dbeafe' : '#e2e8f0'
  const edgeColor = selected ? '#4f46e5' : '#1e293b'

  return (
    <group ref={groupRef} position={[node.x + size / 2, elevation, node.y + size / 2]}>
      {/* Person silhouette — body */}
      <mesh
        geometry={geoms.body}
        position={[0, 0, -EXTRUDE_DEPTH / 2]}
        castShadow
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <meshStandardMaterial color={meshColor} roughness={0.5} metalness={0.05} />
      </mesh>

      {/* Person silhouette — head */}
      <mesh
        geometry={geoms.head}
        position={[0, 0, -EXTRUDE_DEPTH / 2]}
        castShadow
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <meshStandardMaterial color={meshColor} roughness={0.5} metalness={0.05} />
      </mesh>

      {/* Clean silhouette outlines — front face */}
      <Line points={geoms.bodyOutline} color={edgeColor} lineWidth={3} position={[0, 0, -EXTRUDE_DEPTH / 2]} />
      <Line points={geoms.headOutline} color={edgeColor} lineWidth={3} position={[0, 0, -EXTRUDE_DEPTH / 2]} />
      {/* Back face */}
      <Line points={geoms.bodyOutlineBack} color={edgeColor} lineWidth={1.5} position={[0, 0, -EXTRUDE_DEPTH / 2]} />
      <Line points={geoms.headOutlineBack} color={edgeColor} lineWidth={1.5} position={[0, 0, -EXTRUDE_DEPTH / 2]} />

      {/* Ground shadow — person silhouette flat on floor */}
      <group
        position={[shadowCfg?.x ?? 0, 0.05, shadowCfg?.z ?? 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[shadowCfg?.scaleX ?? 1.1, shadowCfg?.scaleZ ?? 1, 1]}
      >
        <mesh geometry={geoms.bodyShadow}>
          <meshBasicMaterial color="#000" transparent opacity={shadowCfg?.opacity ?? 0.1} />
        </mesh>
        <mesh geometry={geoms.headShadow}>
          <meshBasicMaterial color="#000" transparent opacity={shadowCfg?.opacity ?? 0.1} />
        </mesh>
      </group>

      {/* Status LED */}
      <mesh position={[2.5, 10.2, 0]}>
        <sphereGeometry args={[0.8, 12, 12]} />
        <meshStandardMaterial
          color={active ? '#22c55e' : '#94a3b8'}
          emissive={active ? '#22c55e' : '#000000'}
          emissiveIntensity={active ? 0.5 : 0}
        />
      </mesh>

      {/* Name label */}
      <Html position={[0, size + 3, 0]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          padding: '3px 8px',
          background: 'white',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          border: selected ? '2px solid #6366f1' : '1px solid #e2e8f0',
        }}>
          {node.props.name}
          {node.props.role && (
            <span style={{ color: '#94a3b8', fontSize: '10px', display: 'block' }}>
              {node.props.role}
            </span>
          )}
        </div>
      </Html>
    </group>
  )
}

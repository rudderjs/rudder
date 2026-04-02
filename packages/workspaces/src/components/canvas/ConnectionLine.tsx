// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import type { ConnectionNode, CanvasNode } from '../../canvas/CanvasNode.js'

interface ConnectionLineProps {
  node: ConnectionNode
  nodes: Map<string, CanvasNode>
  selected: boolean
  onSelect: (id: string) => void
  dragOverride?: { id: string; x: number; z: number } | null
}

const LINE_Y = 1.0  // Above department surface (dept height=1, top at y=0.5)
const LINE_WIDTH = 1.5
const LINE_HEIGHT = 0.3

/** Flat box segment on the floor — used instead of <line> for visible thickness */
function FloorSegment({
  from,
  to,
  color,
}: {
  from: [number, number, number]
  to: [number, number, number]
  color: string
}) {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 0.1) return null

  const cx = (from[0] + to[0]) / 2
  const cz = (from[2] + to[2]) / 2
  const angle = Math.atan2(dx, dz)

  return (
    <mesh position={[cx, LINE_Y, cz]} rotation={[0, angle, 0]}>
      <boxGeometry args={[LINE_WIDTH, LINE_HEIGHT, length]} />
      <meshStandardMaterial color={color} transparent opacity={0.7} />
    </mesh>
  )
}

/** L-shaped connection drawn flat on the floor */
export function ConnectionLine({ node, nodes, selected, onSelect, dragOverride }: ConnectionLineProps) {
  const fromNode = nodes.get(node.props.fromId)
  const toNode = nodes.get(node.props.toId)

  // Use live drag position if one of the connected nodes is being dragged
  const fx = dragOverride?.id === node.props.fromId ? dragOverride.x : fromNode?.x
  const fz = dragOverride?.id === node.props.fromId ? dragOverride.z : fromNode?.y
  const tx = dragOverride?.id === node.props.toId ? dragOverride.x : toNode?.x
  const tz = dragOverride?.id === node.props.toId ? dragOverride.z : toNode?.y

  const geometry = useMemo(() => {
    if (fx == null || fz == null || tx == null || tz == null) return null
    const from = [fx, LINE_Y, fz] as [number, number, number]
    const corner = [fx, LINE_Y, tz] as [number, number, number]
    const to = [tx, LINE_Y, tz] as [number, number, number]
    const mid = [
      (fx + tx) / 2,
      LINE_Y + 1,
      (fz + tz) / 2,
    ] as [number, number, number]
    return { from, corner, to, mid }
  }, [fx, fz, tx, tz])

  if (!geometry) return null

  const color = selected ? '#6366f1' : '#3b82f6'

  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(node.id) }}>
      <FloorSegment from={geometry.from} to={geometry.corner} color={color} />
      <FloorSegment from={geometry.corner} to={geometry.to} color={color} />

      {/* Arrow dot at target */}
      <mesh position={geometry.to}>
        <sphereGeometry args={[1.5, 12, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Label */}
      {node.props.label && (
        <Html position={geometry.mid} center style={{ pointerEvents: 'none' }}>
          <div style={{
            padding: '2px 6px',
            background: 'rgba(255,255,255,0.9)',
            borderRadius: '3px',
            fontSize: '10px',
            color: '#64748b',
            whiteSpace: 'nowrap',
          }}>
            {node.props.label}
          </div>
        </Html>
      )}
    </group>
  )
}

/** Preview L-shaped connection (used during drag) */
export function ConnectionPreview({
  fromX, fromZ, toX, toZ, color = '#3b82f6',
}: {
  fromX: number; fromZ: number; toX: number; toZ: number; color?: string
}) {
  const from = [fromX, LINE_Y, fromZ] as [number, number, number]
  const corner = [fromX, LINE_Y, toZ] as [number, number, number]
  const to = [toX, LINE_Y, toZ] as [number, number, number]

  return (
    <>
      <FloorSegment from={from} to={corner} color={color} />
      <FloorSegment from={corner} to={to} color={color} />
    </>
  )
}

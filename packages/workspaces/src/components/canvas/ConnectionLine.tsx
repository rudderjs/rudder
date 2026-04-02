// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import type { ConnectionNode, CanvasNode } from '../../canvas/CanvasNode.js'
import { getHandleWorldPos } from '../../canvas/CanvasNode.js'

interface ConnectionLineProps {
  node: ConnectionNode
  nodes: Map<string, CanvasNode>
  selected: boolean
  onSelect: (id: string) => void
  dragOverride?: { id: string; x: number; z: number } | null
}

const LINE_Y = 1.0
const LINE_WIDTH = 1.5
const LINE_HEIGHT = 0.3

/** Flat box segment on the floor */
function FloorSegment({
  from, to, color,
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

/** L-shaped connection on the floor, using handle positions */
export function ConnectionLine({ node, nodes, selected, onSelect, dragOverride }: ConnectionLineProps) {
  const fromNode = nodes.get(node.props.fromId)
  const toNode = nodes.get(node.props.toId)

  const geometry = useMemo(() => {
    if (!fromNode || !toNode) return null

    // Get override positions for dragging nodes
    const fOverX = dragOverride?.id === node.props.fromId ? dragOverride.x : undefined
    const fOverZ = dragOverride?.id === node.props.fromId ? dragOverride.z : undefined
    const tOverX = dragOverride?.id === node.props.toId ? dragOverride.x : undefined
    const tOverZ = dragOverride?.id === node.props.toId ? dragOverride.z : undefined

    const fromHandle = node.props.fromHandle ?? 'right'
    const toHandle = node.props.toHandle ?? 'left'

    const fp = getHandleWorldPos(fromNode, fromHandle, fOverX, fOverZ)
    const tp = getHandleWorldPos(toNode, toHandle, tOverX, tOverZ)

    const from = [fp.x, LINE_Y, fp.z] as [number, number, number]
    const to = [tp.x, LINE_Y, tp.z] as [number, number, number]
    // L-bend direction: exit horizontal from left/right handles, vertical from top/bottom
    const corner = (fromHandle === 'left' || fromHandle === 'right')
      ? [tp.x, LINE_Y, fp.z] as [number, number, number]   // horizontal first
      : [fp.x, LINE_Y, tp.z] as [number, number, number]   // vertical first
    const mid = [(fp.x + tp.x) / 2, LINE_Y + 1, (fp.z + tp.z) / 2] as [number, number, number]

    return { from, corner, to, mid }
  }, [fromNode, toNode, node.props, dragOverride])

  if (!geometry) return null
  const color = selected ? '#6366f1' : '#3b82f6'

  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(node.id) }}>
      <FloorSegment from={geometry.from} to={geometry.corner} color={color} />
      <FloorSegment from={geometry.corner} to={geometry.to} color={color} />
      <mesh position={geometry.to}>
        <sphereGeometry args={[1.5, 12, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {node.props.label && (
        <Html position={geometry.mid} center style={{ pointerEvents: 'none' }}>
          <div style={{
            padding: '2px 6px', background: 'rgba(255,255,255,0.9)',
            borderRadius: '3px', fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap',
          }}>
            {node.props.label}
          </div>
        </Html>
      )}
    </group>
  )
}

/** Preview L-shaped connection */
export function ConnectionPreview({
  fromX, fromZ, toX, toZ, fromHandle = 'right', color = '#6366f1',
}: {
  fromX: number; fromZ: number; toX: number; toZ: number
  fromHandle?: 'top' | 'bottom' | 'left' | 'right'; color?: string
}) {
  const from = [fromX, LINE_Y, fromZ] as [number, number, number]
  const to = [toX, LINE_Y, toZ] as [number, number, number]
  const corner = (fromHandle === 'left' || fromHandle === 'right')
    ? [toX, LINE_Y, fromZ] as [number, number, number]
    : [fromX, LINE_Y, toZ] as [number, number, number]
  return (
    <>
      <FloorSegment from={from} to={corner} color={color} />
      <FloorSegment from={corner} to={to} color={color} />
    </>
  )
}

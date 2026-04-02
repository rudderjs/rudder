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
const HANDLE_GAP = 6  // Small stem extending from handle before bending

/** Offset a handle position by GAP in its exit direction */
function handleOffset(pos: { x: number; z: number }, handle: string): { x: number; z: number } {
  switch (handle) {
    case 'right':  return { x: pos.x + HANDLE_GAP, z: pos.z }
    case 'left':   return { x: pos.x - HANDLE_GAP, z: pos.z }
    case 'bottom': return { x: pos.x, z: pos.z + HANDLE_GAP }
    case 'top':    return { x: pos.x, z: pos.z - HANDLE_GAP }
    default:       return pos
  }
}

/** Pick the L-bend corner that follows the handle exit direction cleanly */
function smartCorner(
  fp: { x: number; z: number },
  tp: { x: number; z: number },
  fromHandle: string,
): [number, number, number] {
  const isHorizontalHandle = fromHandle === 'left' || fromHandle === 'right'

  if (isHorizontalHandle) {
    // Check if horizontal-first would backtrack
    const goingRight = fromHandle === 'right'
    const targetIsRight = tp.x > fp.x
    if (goingRight === targetIsRight) {
      return [tp.x, LINE_Y, fp.z] // horizontal first
    }
    return [fp.x, LINE_Y, tp.z] // flip to vertical first
  }

  // Vertical handle (top/bottom)
  const goingDown = fromHandle === 'bottom'
  const targetIsBelow = tp.z > fp.z
  if (goingDown === targetIsBelow) {
    return [fp.x, LINE_Y, tp.z] // vertical first
  }
  return [tp.x, LINE_Y, fp.z] // flip to horizontal first
}

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

    // Small stems from both handles, then L-bend between them
    const fo = handleOffset(fp, fromHandle)
    const toOff = handleOffset(tp, toHandle)
    const corner = smartCorner(fo, toOff, fromHandle)

    const from = [fp.x, LINE_Y, fp.z] as [number, number, number]
    const fromOffPt = [fo.x, LINE_Y, fo.z] as [number, number, number]
    const toOffPt = [toOff.x, LINE_Y, toOff.z] as [number, number, number]
    const to = [tp.x, LINE_Y, tp.z] as [number, number, number]
    const mid = [(fp.x + tp.x) / 2, LINE_Y + 1, (fp.z + tp.z) / 2] as [number, number, number]

    return { from, fromOff: fromOffPt, corner, toOff: toOffPt, to, mid }
  }, [fromNode, toNode, node.props, dragOverride])

  if (!geometry) return null
  const color = selected ? '#6366f1' : '#3b82f6'

  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(node.id) }}>
      <FloorSegment from={geometry.from} to={geometry.fromOff} color={color} />
      <FloorSegment from={geometry.fromOff} to={geometry.corner} color={color} />
      <FloorSegment from={geometry.corner} to={geometry.toOff} color={color} />
      <FloorSegment from={geometry.toOff} to={geometry.to} color={color} />
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
  fromX, fromZ, toX, toZ, fromHandle = 'right', toHandle = null, color = '#6366f1',
}: {
  fromX: number; fromZ: number; toX: number; toZ: number
  fromHandle?: 'top' | 'bottom' | 'left' | 'right'
  toHandle?: 'top' | 'bottom' | 'left' | 'right' | null
  color?: string
}) {
  const fp = { x: fromX, z: fromZ }
  const tp = { x: toX, z: toZ }
  const fo = handleOffset(fp, fromHandle)

  if (toHandle) {
    // Snapped to target — show full routing with both stems
    const toOff = handleOffset(tp, toHandle)
    const corner = smartCorner(fo, toOff, fromHandle)
    const from = [fp.x, LINE_Y, fp.z] as [number, number, number]
    const fromOffPt = [fo.x, LINE_Y, fo.z] as [number, number, number]
    const toOffPt = [toOff.x, LINE_Y, toOff.z] as [number, number, number]
    const to = [tp.x, LINE_Y, tp.z] as [number, number, number]
    return (
      <>
        <FloorSegment from={from} to={fromOffPt} color={color} />
        <FloorSegment from={fromOffPt} to={corner} color={color} />
        <FloorSegment from={corner} to={toOffPt} color={color} />
        <FloorSegment from={toOffPt} to={to} color={color} />
      </>
    )
  }

  // No snap — simple routing to cursor
  const corner = smartCorner(fo, tp, fromHandle)
  const from = [fp.x, LINE_Y, fp.z] as [number, number, number]
  const fromOff = [fo.x, LINE_Y, fo.z] as [number, number, number]
  const to = [tp.x, LINE_Y, tp.z] as [number, number, number]
  return (
    <>
      <FloorSegment from={from} to={fromOff} color={color} />
      <FloorSegment from={fromOff} to={corner} color={color} />
      <FloorSegment from={corner} to={to} color={color} />
    </>
  )
}

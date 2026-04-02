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

/** Offset a handle position by GAP in its exit direction. Invert for inline (go inward). */
function handleOffset(pos: { x: number; z: number }, handle: string, invert = false): { x: number; z: number } {
  const g = invert ? -HANDLE_GAP : HANDLE_GAP
  switch (handle) {
    case 'right':  return { x: pos.x + g, z: pos.z }
    case 'left':   return { x: pos.x - g, z: pos.z }
    case 'bottom': return { x: pos.x, z: pos.z + g }
    case 'top':    return { x: pos.x, z: pos.z - g }
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

/** Check if a node is inside a department's bounds */
function isNodeInsideDepartment(child: CanvasNode, dept: CanvasNode): boolean {
  if (dept.type !== 'department') return false
  const hw = (dept.width || 200) / 2
  const hh = (dept.height || 150) / 2
  return Math.abs(child.x - dept.x) <= hw && Math.abs(child.y - dept.y) <= hh
}

/** Dotted floor segment for parent-child relationships */
function DottedFloorSegment({
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

  // Draw dashes along the segment
  const count = Math.max(1, Math.floor(length / 6))
  const dashes: JSX.Element[] = []
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const px = from[0] + dx * t
    const pz = from[2] + dz * t
    const angle = Math.atan2(dx, dz)
    const dashLen = Math.min(3, length / count * 0.6)
    dashes.push(
      <mesh key={i} position={[px, LINE_Y, pz]} rotation={[0, angle, 0]}>
        <boxGeometry args={[LINE_WIDTH * 0.8, LINE_HEIGHT, dashLen]} />
        <meshStandardMaterial color={color} transparent opacity={0.5} />
      </mesh>
    )
  }
  return <>{dashes}</>
}

/** Connection on the floor — L-shaped for regular, straight dotted for parent-child */
export function ConnectionLine({ node, nodes, selected, onSelect, dragOverride }: ConnectionLineProps) {
  const fromNode = nodes.get(node.props.fromId)
  const toNode = nodes.get(node.props.toId)

  // Get override positions for dragging nodes
  const fOverX = dragOverride?.id === node.props.fromId ? dragOverride.x : undefined
  const fOverZ = dragOverride?.id === node.props.fromId ? dragOverride.z : undefined
  const tOverX = dragOverride?.id === node.props.toId ? dragOverride.x : undefined
  const tOverZ = dragOverride?.id === node.props.toId ? dragOverride.z : undefined

  // Detect parent-child using live drag positions
  const isInline = useMemo(() => {
    if (!fromNode || !toNode) return false
    // Use drag override positions if available
    const fNode = dragOverride?.id === fromNode.id
      ? { ...fromNode, x: dragOverride.x, y: dragOverride.z }
      : fromNode
    const tNode = dragOverride?.id === toNode.id
      ? { ...toNode, x: dragOverride.x, y: dragOverride.z }
      : toNode
    return isNodeInsideDepartment(fNode, tNode) || isNodeInsideDepartment(tNode, fNode)
  }, [fromNode, toNode, dragOverride])

  const geometry = useMemo(() => {
    if (!fromNode || !toNode) return null

    const fx = fOverX ?? fromNode.x
    const fz = fOverZ ?? fromNode.y
    const tx = tOverX ?? toNode.x
    const tz = tOverZ ?? toNode.y

    const routing = node.props.routing ?? 'L'
    const fromHandle = node.props.fromHandle ?? (isInline ? 'bottom' : 'right')
    const toHandle = node.props.toHandle ?? (isInline ? 'top' : 'left')

    const fp = getHandleWorldPos(fromNode, fromHandle, fOverX, fOverZ)
    const tp = getHandleWorldPos(toNode, toHandle, tOverX, tOverZ)

    const from = [fp.x, LINE_Y, fp.z] as [number, number, number]
    const to = [tp.x, LINE_Y, tp.z] as [number, number, number]
    const mid = [(fp.x + tp.x) / 2, LINE_Y + 1, (fp.z + tp.z) / 2] as [number, number, number]

    if (routing === 'straight') {
      return { type: 'straight' as const, isInline, from, to, mid }
    }

    // L-shaped routing with stems — inline stems go inward, regular go outward
    const fo = handleOffset(fp, fromHandle, isInline)
    const toOff = handleOffset(tp, toHandle, isInline)
    const corner = smartCorner(fo, toOff, fromHandle)

    const fromOffPt = [fo.x, LINE_Y, fo.z] as [number, number, number]
    const toOffPt = [toOff.x, LINE_Y, toOff.z] as [number, number, number]

    return { type: 'L' as const, isInline, from, fromOff: fromOffPt, corner, toOff: toOffPt, to, mid }
  }, [fromNode, toNode, node.props, dragOverride, fOverX, fOverZ, tOverX, tOverZ, isInline])

  if (!geometry) return null
  const color = selected ? '#6366f1' : '#3b82f6'
  const isDotted = geometry.isInline
  const Seg = isDotted ? DottedFloorSegment : FloorSegment

  const label = node.props.label ? (
    <Html position={geometry.mid} center style={{ pointerEvents: 'none' }}>
      <div style={{
        padding: '2px 6px', background: 'rgba(255,255,255,0.9)',
        borderRadius: '3px', fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap',
      }}>
        {node.props.label}
      </div>
    </Html>
  ) : null

  const endDot = (
    <mesh position={geometry.to}>
      <sphereGeometry args={[isDotted ? 1.2 : 1.5, 12, 12]} />
      <meshStandardMaterial color={color} transparent={isDotted} opacity={isDotted ? 0.5 : 1} />
    </mesh>
  )

  if (geometry.type === 'straight') {
    return (
      <group onClick={(e) => { e.stopPropagation(); onSelect(node.id) }}>
        <Seg from={geometry.from} to={geometry.to} color={color} />
        {endDot}
        {label}
      </group>
    )
  }

  // L-shaped with stems
  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(node.id) }}>
      <Seg from={geometry.from} to={geometry.fromOff} color={color} />
      <Seg from={geometry.fromOff} to={geometry.corner} color={color} />
      <Seg from={geometry.corner} to={geometry.toOff} color={color} />
      <Seg from={geometry.toOff} to={geometry.to} color={color} />
      {endDot}
      {label}
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

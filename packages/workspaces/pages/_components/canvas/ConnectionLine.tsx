import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import type { ConnectionNode, CanvasNode } from '../../../src/canvas/CanvasNode.js'

interface ConnectionLineProps {
  node: ConnectionNode
  nodes: Map<string, CanvasNode>
  selected: boolean
  onSelect: (id: string) => void
}

/** Arrow line connecting two nodes */
export function ConnectionLine({ node, nodes, selected, onSelect }: ConnectionLineProps) {
  const fromNode = nodes.get(node.props.fromId)
  const toNode = nodes.get(node.props.toId)

  const geometry = useMemo(() => {
    if (!fromNode || !toNode) return null

    const fromY = getNodeElevation(fromNode)
    const toY = getNodeElevation(toNode)

    return {
      from: [fromNode.x, fromY, fromNode.y] as [number, number, number],
      to: [toNode.x, toY, toNode.y] as [number, number, number],
      mid: [
        (fromNode.x + toNode.x) / 2,
        Math.max(fromY, toY) + 5,
        (fromNode.y + toNode.y) / 2,
      ] as [number, number, number],
    }
  }, [fromNode, toNode])

  if (!geometry) return null

  const style = node.props.style ?? 'solid'
  const color = selected ? '#6366f1' : '#94a3b8'

  return (
    <group onClick={(e) => { e.stopPropagation(); onSelect(node.id) }}>
      {/* Line */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([...geometry.from, ...geometry.to])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={color}
          linewidth={selected ? 3 : 1.5}
          transparent
          opacity={style === 'dotted' ? 0.5 : 1}
        />
      </line>

      {/* Arrow head at target */}
      <mesh position={geometry.to} lookAt={geometry.from}>
        <coneGeometry args={[1.5, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Label */}
      {node.props.label && (
        <Html
          position={geometry.mid}
          center
          distanceFactor={300}
          style={{ pointerEvents: 'none' }}
        >
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

function getNodeElevation(node: CanvasNode): number {
  switch (node.type) {
    case 'department': return 2
    case 'agent': return 10
    case 'knowledgeBase': return 10
    default: return 5
  }
}

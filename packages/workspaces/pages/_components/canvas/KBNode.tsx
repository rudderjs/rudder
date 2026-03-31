import { useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { KnowledgeBaseNode } from '../../../src/canvas/CanvasNode.js'

interface KBNodeProps {
  node: KnowledgeBaseNode
  selected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  editable: boolean
}

/** Cylinder representing a knowledge base */
export function KBNode({ node, selected, onSelect, onDragEnd, editable }: KBNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, z: 0 })
  const [hovered, setHovered] = useState(false)

  const radius = 8
  const height = 14

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!editable) return
    e.stopPropagation()
    onSelect(node.id)
    setDragging(true)
    setDragOffset({ x: e.point.x - node.x, z: e.point.z - node.y })
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging || !meshRef.current) return
    e.stopPropagation()
    meshRef.current.position.x = e.point.x - dragOffset.x
    meshRef.current.position.z = e.point.z - dragOffset.z
  }

  const handlePointerUp = () => {
    if (!dragging) return
    setDragging(false)
    if (meshRef.current) {
      onDragEnd(node.id, meshRef.current.position.x, meshRef.current.position.z)
    }
  }

  return (
    <group>
      {/* KB cylinder (stacked disks look) */}
      <mesh
        ref={meshRef}
        position={[node.x, height / 2 + 2, node.y]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        castShadow
      >
        <cylinderGeometry args={[radius, radius, height, 24]} />
        <meshStandardMaterial
          color={selected ? '#f59e0b' : hovered ? '#fbbf24' : '#fcd34d'}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>

      {/* Top disk accent */}
      <mesh position={[node.x, height + 2, node.y]}>
        <cylinderGeometry args={[radius, radius, 1, 24]} />
        <meshStandardMaterial
          color={selected ? '#d97706' : '#f59e0b'}
          roughness={0.3}
        />
      </mesh>

      {/* Name label */}
      <Html
        position={[node.x, height + 8, node.y]}
        center
        distanceFactor={300}
        style={{ pointerEvents: 'none' }}
      >
        <div style={{
          padding: '3px 8px',
          background: 'white',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          border: selected ? '2px solid #f59e0b' : '1px solid #e2e8f0',
        }}>
          {node.props.name}
        </div>
      </Html>
    </group>
  )
}

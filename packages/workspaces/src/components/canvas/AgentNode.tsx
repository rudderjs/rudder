// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { AgentNode as AgentNodeType } from '../../canvas/CanvasNode.js'

interface AgentNodeProps {
  node: AgentNodeType
  selected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  editable: boolean
}

/** 3D box representing an AI agent with status LED */
export function AgentNode({ node, selected, onSelect, onDragEnd, editable }: AgentNodeProps) {
  const meshRef = useRef<Mesh>(null)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, z: 0 })
  const [hovered, setHovered] = useState(false)

  const size = 12
  const active = node.props.active !== false

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
      {/* Agent body */}
      <mesh
        ref={meshRef}
        position={[node.x, size / 2 + 2, node.y]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        castShadow
      >
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial
          color={selected ? '#6366f1' : hovered ? '#818cf8' : '#94a3b8'}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* Status LED */}
      <mesh position={[node.x + size / 2 - 2, size + 4, node.y - size / 2 + 2]}>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshStandardMaterial
          color={active ? '#22c55e' : '#94a3b8'}
          emissive={active ? '#22c55e' : '#000000'}
          emissiveIntensity={active ? 0.5 : 0}
        />
      </mesh>

      {/* Name label */}
      <Html
        position={[node.x, size + 8, node.y]}
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

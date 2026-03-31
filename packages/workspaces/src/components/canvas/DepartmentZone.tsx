// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { DepartmentNode } from '../../canvas/CanvasNode.js'

interface DepartmentZoneProps {
  node: DepartmentNode
  selected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  editable: boolean
}

/** Translucent colored platform representing a department */
export function DepartmentZone({ node, selected, onSelect, onDragEnd, editable }: DepartmentZoneProps) {
  const meshRef = useRef<Mesh>(null)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, z: 0 })

  const color = node.props.color || '#3b82f6'
  const width = node.width || 200
  const depth = node.height || 150
  const height = 2

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!editable) return
    e.stopPropagation()
    onSelect(node.id)
    setDragging(true)
    setDragOffset({ x: e.point.x - node.x, z: e.point.z - node.y })
    ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging || !meshRef.current) return
    e.stopPropagation()
    meshRef.current.position.x = e.point.x - dragOffset.x
    meshRef.current.position.z = e.point.z - dragOffset.z
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return
    setDragging(false)
    if (meshRef.current) {
      onDragEnd(node.id, meshRef.current.position.x, meshRef.current.position.z)
    }
  }

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[node.x, 0, node.y]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={selected ? 0.5 : 0.3}
          roughness={0.8}
        />

        {/* Selection outline */}
        {selected && meshRef.current?.geometry && (
          <lineSegments>
            <edgesGeometry args={[meshRef.current.geometry]} />
            <lineBasicMaterial color={color} linewidth={2} />
          </lineSegments>
        )}
      </mesh>

      {/* Label */}
      <Html
        position={[node.x, height + 2, node.y - depth / 2 + 10]}
        center
        distanceFactor={300}
        style={{ pointerEvents: 'none' }}
      >
        <div style={{
          padding: '4px 12px',
          background: color,
          color: 'white',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          {node.props.name}
        </div>
      </Html>
    </group>
  )
}

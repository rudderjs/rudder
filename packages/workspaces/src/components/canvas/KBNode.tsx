// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useRef, useState, useEffect, useCallback } from 'react'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group } from 'three'
import type { KnowledgeBaseNode } from '../../canvas/CanvasNode.js'

interface KBNodeProps {
  node: KnowledgeBaseNode
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: () => void
  onDragEnd: (id: string, x: number, y: number) => void
  editable: boolean
}

/** Cylinder representing a knowledge base */
export function KBNode({ node, selected, onSelect, onDragStart, onDragEnd, editable }: KBNodeProps) {
  const groupRef = useRef<Group>(null)
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, z: 0 })
  const [hovered, setHovered] = useState(false)
  const { gl, raycaster, camera } = useThree()

  const radius = 8
  const height = 14

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
        groupRef.current.position.x = worldX - dragOffset.current.x
        groupRef.current.position.z = worldZ - dragOffset.current.z
      }
    }

    const handlePointerUp = () => {
      if (!dragging.current) return
      dragging.current = false
      canvas.style.cursor = ''
      if (groupRef.current) {
        onDragEnd(node.id, groupRef.current.position.x, groupRef.current.position.z)
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
    if (!editable) return
    const ray = e.ray ?? raycaster.ray
    const t = -ray.origin.y / ray.direction.y
    const groundX = ray.origin.x + ray.direction.x * t
    const groundZ = ray.origin.z + ray.direction.z * t
    dragging.current = true
    dragOffset.current = { x: groundX - node.x, z: groundZ - node.y }
    gl.domElement.style.cursor = 'grabbing'
    onDragStart()
  }, [editable, node.id, node.x, node.y, onSelect, onDragStart, gl, raycaster])

  return (
    <group ref={groupRef} position={[node.x, 0, node.y]}>
      {/* KB cylinder */}
      <mesh
        position={[0, height / 2 + 2, 0]}
        onPointerDown={handlePointerDown}
        onPointerEnter={() => { setHovered(true); gl.domElement.style.cursor = editable ? 'grab' : 'pointer' }}
        onPointerLeave={() => { setHovered(false); if (!dragging.current) gl.domElement.style.cursor = '' }}
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
      <mesh position={[0, height + 2, 0]}>
        <cylinderGeometry args={[radius, radius, 1, 24]} />
        <meshStandardMaterial
          color={selected ? '#d97706' : '#f59e0b'}
          roughness={0.3}
        />
      </mesh>

      {/* Name label */}
      <Html
        position={[0, height + 8, 0]}
        center
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

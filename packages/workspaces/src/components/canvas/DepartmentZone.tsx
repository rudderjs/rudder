// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useRef, useState, useEffect, useCallback } from 'react'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group, Mesh } from 'three'
import type { DepartmentNode } from '../../canvas/CanvasNode.js'

interface DepartmentZoneProps {
  node: DepartmentNode
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: () => void
  onDragEnd: (id: string, x: number, y: number) => void
  editable: boolean
}

/** Translucent colored platform representing a department */
export function DepartmentZone({ node, selected, onSelect, onDragStart, onDragEnd, editable }: DepartmentZoneProps) {
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, z: 0 })
  const { gl, raycaster, camera } = useThree()

  const color = node.props.color || '#3b82f6'
  const width = node.width || 200
  const depth = node.height || 150
  const height = 1

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
        const cx = worldX - dragOffset.current.x
        const cz = worldZ - dragOffset.current.z
        // Snap edges to grid (10-unit), then convert back to center
        const w = node.width || 200
        const d = node.height || 150
        const snapLeft = Math.round((cx - w / 2) / 10) * 10
        const snapTop = Math.round((cz - d / 2) / 10) * 10
        groupRef.current.position.x = snapLeft + w / 2
        groupRef.current.position.z = snapTop + d / 2
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
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
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
        position={[0, height + 2, -depth / 2 + 10]}
        center
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

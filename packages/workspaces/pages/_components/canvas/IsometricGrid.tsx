import { useMemo } from 'react'

interface IsometricGridProps {
  size?: number
  divisions?: number
  color?: string
}

/** Subtle isometric grid for visual alignment */
export function IsometricGrid({ size = 100, divisions = 20, color = '#e2e8f0' }: IsometricGridProps) {
  const lines = useMemo(() => {
    const step = size / divisions
    const half = size / 2
    const positions: [number, number, number][][] = []

    for (let i = -half; i <= half; i += step) {
      // X-axis lines
      positions.push([[-half, 0, i], [half, 0, i]])
      // Z-axis lines
      positions.push([[i, 0, -half], [i, 0, half]])
    }

    return positions
  }, [size, divisions])

  return (
    <group>
      {lines.map((line, i) => (
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([...line[0]!, ...line[1]!])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} transparent opacity={0.3} />
        </line>
      ))}
    </group>
  )
}

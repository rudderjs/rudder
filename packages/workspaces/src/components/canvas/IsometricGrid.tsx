// @ts-nocheck — Three.js JSX validated by Vite, not tsc

interface IsometricGridProps {
  size?: number
  divisions?: number
  color?: string
}

/** Large grid floor — 10-unit cells matching GRID_SNAP */
export function IsometricGrid({ size = 2000, divisions = 200, color = '#94a3b8' }: IsometricGridProps) {
  return (
    <gridHelper
      args={[size, divisions, color, color]}
      position={[0, -0.5, 0]}
      material-transparent={true}
      material-opacity={0.4}
    />
  )
}

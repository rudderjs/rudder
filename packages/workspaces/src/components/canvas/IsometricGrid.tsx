// @ts-nocheck — Three.js JSX validated by Vite, not tsc

interface IsometricGridProps {
  size?: number
  divisions?: number
  color?: string
}

/** Large grid floor that fills the visible canvas */
export function IsometricGrid({ size = 2000, divisions = 200, color = '#cbd5e1' }: IsometricGridProps) {
  return (
    <gridHelper
      args={[size, divisions, color, color]}
      position={[0, -0.5, 0]}
      material-transparent={true}
      material-opacity={0.4}
    />
  )
}

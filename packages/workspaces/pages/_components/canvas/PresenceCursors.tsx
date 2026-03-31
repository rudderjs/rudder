import { useState, useEffect } from 'react'
import { Html } from '@react-three/drei'

interface PresenceCursorsProps {
  awareness: any | null
}

interface UserState {
  user?: { name: string; color: string }
  cursor?: { x: number; y: number }
  selectedNodeId?: string
}

/** Render other users' cursors on the canvas */
export function PresenceCursors({ awareness }: PresenceCursorsProps) {
  const [others, setOthers] = useState<Map<number, UserState>>(new Map())

  useEffect(() => {
    if (!awareness) return

    const update = () => {
      const states = new Map<number, UserState>()
      const localId = awareness.clientID

      awareness.getStates().forEach((state: UserState, clientId: number) => {
        if (clientId !== localId && state.user && state.cursor) {
          states.set(clientId, state)
        }
      })
      setOthers(states)
    }

    awareness.on('change', update)
    update()

    return () => { awareness.off('change', update) }
  }, [awareness])

  return (
    <group>
      {Array.from(others.entries()).map(([clientId, state]) => {
        if (!state.cursor || !state.user) return null
        return (
          <group key={clientId}>
            {/* Cursor dot */}
            <mesh position={[state.cursor.x, 3, state.cursor.y]}>
              <sphereGeometry args={[2, 16, 16]} />
              <meshStandardMaterial
                color={state.user.color}
                emissive={state.user.color}
                emissiveIntensity={0.3}
              />
            </mesh>

            {/* Name tag */}
            <Html
              position={[state.cursor.x + 3, 6, state.cursor.y]}
              distanceFactor={300}
              style={{ pointerEvents: 'none' }}
            >
              <div style={{
                padding: '2px 6px',
                background: state.user.color,
                color: 'white',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>
                {state.user.name}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

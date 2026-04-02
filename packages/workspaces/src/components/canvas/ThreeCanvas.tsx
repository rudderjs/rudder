// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { Suspense, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CanvasScene } from './CanvasScene.js'
import type { CanvasStoreReturn } from '../../canvas/useCanvasStore.js'
import type { UseCanvasViewportReturn } from '../../canvas/useCanvasViewport.js'
import type { CanvasTool } from './CanvasToolbar.js'

interface ThreeCanvasProps {
  store: CanvasStoreReturn
  viewport: UseCanvasViewportReturn
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  activeTool: CanvasTool
  editable: boolean
  camPos: { x: number; y: number; z: number }
  onCamPosChange: (pos: { x: number; y: number; z: number }) => void
  shadowCfg?: { x: number; z: number; scaleX: number; scaleZ: number; radius: number; opacity: number } | undefined
  onReady?: (() => void) | undefined
}

/** Fires onReady once the Three.js renderer is initialized */
function ReadyNotifier({ onReady }: { onReady?: (() => void) | undefined }) {
  const { gl } = useThree()
  useEffect(() => {
    if (gl && onReady) onReady()
  }, [gl, onReady])
  return null
}

/** Three.js canvas — only imported client-side via React.lazy() */
export default function ThreeCanvas({
  store,
  viewport,
  selectedNodeId,
  onSelectNode,
  activeTool,
  editable,
  camPos,
  onCamPosChange,
  shadowCfg,
  onReady,
}: ThreeCanvasProps) {
  return (
    <Canvas
      orthographic
      camera={{
        zoom: viewport.viewport.zoom,
        position: [camPos.x, camPos.y, camPos.z],
        near: -1000,
        far: 2000,
      }}
      shadows
      style={{
        background: '#f8fafc',
        borderRadius: 8,
        width: '100%',
        height: '100%',
      }}
    >
      <ReadyNotifier onReady={onReady} />
      <Suspense fallback={null}>
        <CanvasScene
          store={store}
          viewport={viewport}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          activeTool={activeTool}
          editable={editable}
          camPos={camPos}
          onCamPosChange={onCamPosChange}
          shadowCfg={shadowCfg}
        />
      </Suspense>
    </Canvas>
  )
}

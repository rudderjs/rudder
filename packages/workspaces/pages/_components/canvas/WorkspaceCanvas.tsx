import { useState, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { useCanvasStore } from '../../../src/canvas/useCanvasStore.js'
import { useCanvasViewport } from '../../../src/canvas/useCanvasViewport.js'
import { CanvasScene } from './CanvasScene.js'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar.js'

interface WorkspaceCanvasProps {
  /** Workspace ID — used for Yjs room name */
  workspaceId: string
  /** Initial nodes JSON (from DB) */
  initialNodes?: Record<string, any>
  /** WebSocket path for collaboration */
  wsPath?: string | null
  /** Allow editing */
  editable?: boolean
  /** Enable Yjs collaboration */
  collaborative?: boolean
  /** Persist viewport in localStorage */
  persist?: boolean
  /** Canvas height (for field mode) */
  height?: number
  /** Current user name */
  userName?: string
  /** Current user color */
  userColor?: string
}

/**
 * Main workspace canvas component.
 * Renders a Three.js isometric scene with collaborative editing.
 */
export function WorkspaceCanvas({
  workspaceId,
  initialNodes,
  wsPath = '/ws-live',
  editable = false,
  collaborative = false,
  persist = false,
  height,
  userName,
  userColor,
}: WorkspaceCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')

  const store = useCanvasStore({
    wsPath: collaborative ? wsPath : null,
    roomName: `workspace:${workspaceId}:canvas`,
    initialNodes,
    userName,
    userColor,
  })

  const viewport = useCanvasViewport({
    storageKey: `workspace:${workspaceId}:viewport`,
    persist,
  })

  if (!store.ready) {
    return (
      <div style={{
        width: '100%',
        height: height ?? '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        borderRadius: 8,
        color: '#94a3b8',
        fontSize: 14,
      }}>
        Loading workspace…
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: height ?? '100%', minHeight: 400 }}>
      <CanvasToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        editable={editable}
      />

      <Canvas
        orthographic
        camera={{
          zoom: viewport.viewport.zoom,
          position: [200, 200, 200],
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
        <Suspense fallback={null}>
          <CanvasScene
            store={store}
            viewport={viewport}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            activeTool={activeTool}
            editable={editable}
          />
        </Suspense>
      </Canvas>

      {/* Node count indicator */}
      <div style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        padding: '4px 10px',
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 6,
        fontSize: 11,
        color: '#64748b',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}>
        {store.nodes.size} nodes
      </div>
    </div>
  )
}

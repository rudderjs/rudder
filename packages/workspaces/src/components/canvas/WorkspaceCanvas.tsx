import { useState, useEffect, useRef, lazy, Suspense } from 'react'

// Only import hooks on the client — these are safe (no Three.js/node deps at top level)
let useCanvasStore: any = null
let useCanvasViewport: any = null

interface WorkspaceCanvasProps {
  workspaceId?: string
  initialNodes?: Record<string, any>
  wsPath?: string | null
  editable?: boolean
  collaborative?: boolean
  persist?: boolean
  height?: number
  userName?: string
  userColor?: string
  [key: string]: any
}

const LOADING = (h: number) => (
  <div style={{
    width: '100%',
    height: h,
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

/**
 * Workspace canvas — renders loading placeholder on SSR,
 * lazy-loads Three.js only on client, single transition.
 */
export function WorkspaceCanvas(props: WorkspaceCanvasProps) {
  const h = props.height ?? 500
  const [ClientCanvas, setClientCanvas] = useState<React.ComponentType<any> | null>(null)

  useEffect(() => {
    // Dynamically import everything on client only
    Promise.all([
      import('../../canvas/useCanvasStore.js'),
      import('../../canvas/useCanvasViewport.js'),
      import('./ThreeCanvas.js'),
      import('./CanvasToolbar.js'),
    ]).then(([storeModule, viewportModule, threeModule, toolbarModule]) => {
      useCanvasStore = storeModule.useCanvasStore
      useCanvasViewport = viewportModule.useCanvasViewport

      // Set the inner component that has access to hooks
      setClientCanvas(() => function InnerCanvas() {
        const [canvasReady, setCanvasReady] = useState(false)
        const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
        const [activeTool, setActiveTool] = useState<any>('select')

        const store = useCanvasStore({
          wsPath: props.collaborative ? (props.wsPath ?? '/ws-live') : null,
          roomName: `workspace:${props.workspaceId ?? 'default'}:canvas`,
          initialNodes: props.initialNodes,
          userName: props.userName,
          userColor: props.userColor,
        })

        const viewport = useCanvasViewport({
          storageKey: `workspace:${props.workspaceId ?? 'default'}:viewport`,
          persist: props.persist,
        })

        if (!store.ready) return LOADING(h)

        const ThreeCanvas = threeModule.default
        const CanvasToolbar = toolbarModule.CanvasToolbar

        return (
          <div style={{ position: 'relative', width: '100%', height: h, minHeight: 400 }}>
            {/* Loading overlay — fades out when Three.js is ready */}
            <div style={{
              position: 'absolute', inset: 0, zIndex: 5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#f8fafc', borderRadius: 8,
              color: '#94a3b8', fontSize: 14,
              opacity: canvasReady ? 0 : 1,
              pointerEvents: canvasReady ? 'none' : 'auto',
              transition: 'opacity 0.4s ease',
            }}>
              Loading workspace…
            </div>

            {props.editable && (
              <CanvasToolbar
                activeTool={activeTool}
                onToolChange={setActiveTool}
                editable={true}
              />
            )}

            <ThreeCanvas
              store={store}
              viewport={viewport}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              activeTool={activeTool}
              editable={props.editable ?? false}
              onReady={() => setCanvasReady(true)}
            />

            {canvasReady && (
              <div style={{
                position: 'absolute', bottom: 12, left: 12,
                padding: '4px 10px', background: 'rgba(255,255,255,0.9)',
                borderRadius: 6, fontSize: 11, color: '#64748b',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }}>
                {store.nodes.size} nodes
              </div>
            )}
          </div>
        )
      })
    })
  }, [])

  // SSR + initial client render: always show loading at the correct height
  if (!ClientCanvas) return LOADING(h)

  return <ClientCanvas />
}

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
        const [camPos, setCamPos] = useState({ x: 200, y: 200, z: 200 })
        const [shadowCfg, setShadowCfg] = useState({ x: 0, z: 0, scaleX: 1, scaleZ: 0.7, radius: 0.5, opacity: 0.2 })

        const store = useCanvasStore({
          wsPath: props.collaborative ? (props.wsPath ?? '/ws-live') : null,
          roomName: `workspace:${props.workspaceId ?? 'default'}:canvas`,
          initialNodes: props.initialNodes,
          persist: props.persist,
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
              camPos={camPos}
              onCamPosChange={setCamPos}
              shadowCfg={shadowCfg}
              onReady={() => setCanvasReady(true)}
            />

            {/* Node count */}
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

            {/* DEBUG: Camera controls — fixed to screen, remove after tuning */}
            {canvasReady && (
              <div style={{
                position: 'absolute', top: 12, left: 12,
                background: 'rgba(0,0,0,0.85)', color: '#fff',
                padding: '10px 14px', borderRadius: 8, fontSize: 11, fontFamily: 'monospace',
                zIndex: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Camera</div>
                {(['x', 'y', 'z'] as const).map(axis => (
                  <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 12 }}>{axis.toUpperCase()}</span>
                    <input
                      type="range" min={-500} max={500} step={10}
                      value={camPos[axis]}
                      onChange={e => setCamPos(p => ({ ...p, [axis]: Number(e.target.value) }))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ width: 36, textAlign: 'right' }}>{camPos[axis]}</span>
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #444', paddingTop: 6, marginTop: 2 }}>
                  <span style={{ width: 40 }}>Zoom</span>
                  <input
                    type="range" min={0.3} max={15} step={0.1}
                    value={viewport.viewport.zoom}
                    onChange={e => viewport.setViewport({ zoom: Number(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <span style={{ width: 36, textAlign: 'right' }}>{viewport.viewport.zoom.toFixed(1)}</span>
                </label>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                  pos: [{camPos.x}, {camPos.y}, {camPos.z}] zoom: {viewport.viewport.zoom.toFixed(1)}
                </div>
                {/* Shadow controls */}
                <div style={{ fontWeight: 700, marginTop: 8, borderTop: '1px solid #444', paddingTop: 6 }}>Shadow</div>
                {([
                  ['x', -10, 10, 0.5, shadowCfg.x],
                  ['z', -10, 10, 0.5, shadowCfg.z],
                  ['scaleX', 0.5, 5, 0.1, shadowCfg.scaleX],
                  ['scaleZ', 0.5, 5, 0.1, shadowCfg.scaleZ],
                  ['radius', 0.5, 6, 0.1, shadowCfg.radius],
                  ['opacity', 0, 0.4, 0.01, shadowCfg.opacity],
                ] as const).map(([key, min, max, step, val]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 48, fontSize: 10 }}>{key}</span>
                    <input
                      type="range" min={min} max={max} step={step}
                      value={val}
                      onChange={e => setShadowCfg(p => ({ ...p, [key]: Number(e.target.value) }))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ width: 36, textAlign: 'right', fontSize: 10 }}>{val}</span>
                  </label>
                ))}
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

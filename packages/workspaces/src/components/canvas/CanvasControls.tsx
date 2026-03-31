// @ts-nocheck — Three.js JSX validated by Vite, not tsc
import { useEffect, useRef } from 'react'
import { MapControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrthographicCamera } from 'three'

interface CanvasControlsProps {
  minZoom?: number
  maxZoom?: number
  onChange?: () => void
}

/**
 * Figma/Miro-style controls built on MapControls.
 *
 * MapControls handles camera math (target tracking, orthographic zoom).
 * We intercept wheel events in capture phase to remap:
 *   - ctrlKey wheel (pinch / ctrl+scroll) → pass through to MapControls → zoom
 *   - Regular wheel (trackpad two-finger / mouse scroll) → screen-space pan
 */
export function CanvasControls({
  minZoom = 10,
  maxZoom = 200,
  onChange,
}: CanvasControlsProps) {
  const controlsRef = useRef<any>(null)
  const { camera, gl } = useThree()

  useEffect(() => {
    const canvas = gl.domElement

    const handleWheel = (e: WheelEvent) => {
      if (!controlsRef.current) return

      // ctrlKey = pinch gesture or ctrl+scroll → let MapControls zoom natively
      if (e.ctrlKey || e.metaKey) return

      // Regular scroll → pan in screen space
      e.preventDefault()
      e.stopPropagation()

      const cam = camera as OrthographicCamera
      const controls = controlsRef.current

      // Camera's right and up vectors in world space
      const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
      const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1)

      // Orthographic scale: pixels → world units (same formula as OrbitControls internals)
      const scaleX = (cam.right - cam.left) / cam.zoom / canvas.clientWidth
      const scaleY = (cam.top - cam.bottom) / cam.zoom / canvas.clientHeight

      // Build pan offset along camera-local axes
      const panOffset = new Vector3()
      panOffset.addScaledVector(right, -e.deltaX * scaleX)
      panOffset.addScaledVector(up, e.deltaY * scaleY)

      // Move BOTH camera and target so the look direction stays the same
      cam.position.add(panOffset)
      controls.target.add(panOffset)
      controls.update()

      onChange?.()
    }

    // Capture phase so we intercept before MapControls' own listener
    canvas.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => canvas.removeEventListener('wheel', handleWheel, { capture: true })
  }, [camera, gl, onChange])

  return (
    <MapControls
      ref={controlsRef}
      enableRotate={false}
      enablePan={true}
      enableZoom={true}
      screenSpacePanning={true}
      minZoom={minZoom}
      maxZoom={maxZoom}
      zoomSpeed={1.2}
      onChange={onChange}
    />
  )
}

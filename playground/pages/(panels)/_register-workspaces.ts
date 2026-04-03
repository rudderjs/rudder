import React from 'react'
import { registerElement } from '@rudderjs/panels'

function ClientOnly({ height, loader, factory, elementProps }: {
  height: number
  loader: string
  factory: () => Promise<any>
  elementProps: Record<string, any>
}) {
  const [Comp, setComp] = React.useState<React.ComponentType<any> | null>(null)

  React.useEffect(() => {
    factory().then(m => {
      const C = m.default ?? Object.values(m)[0]
      setComp(() => C)
    })
  }, [])

  if (!Comp) {
    return React.createElement('div', {
      style: {
        width: '100%', height,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8fafc', borderRadius: 8, color: '#94a3b8', fontSize: 14,
      },
    }, `Loading ${loader}…`)
  }

  return React.createElement(Comp, elementProps)
}

// Canvas element — client-only (Three.js)
registerElement('canvas', (props: any) => {
  return React.createElement(ClientOnly, {
    height: props.element?.height ?? 500,
    loader: 'workspace',
    factory: () => import('@rudderjs/workspaces').then(m => ({ default: m.WorkspaceCanvas })),
    elementProps: {
      workspaceId: props.element?.id ?? 'default',
      editable: props.element?.editable ?? false,
      collaborative: props.element?.collaborative ?? false,
      persist: props.element?.persist ?? false,
      height: props.element?.height ?? 500,
    },
  })
})

// Chat element — client-only for now (could be SSR'd later)
registerElement('chat', (props: any) => {
  return React.createElement(ClientOnly, {
    height: props.element?.height ?? 400,
    loader: 'chat',
    factory: () => import('@rudderjs/workspaces').then(m => ({ default: m.ChatPanel })),
    elementProps: {
      workspaceId: props.element?.id ?? 'default',
      height: props.element?.height ?? 400,
      persist: props.element?.persist ?? false,
    },
  })
})

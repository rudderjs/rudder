'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { IconAdapter } from './types.js'
import { lucideAdapter } from './adapters/lucide.js'

type IconLibraryName = 'lucide' | 'tabler' | 'phosphor' | 'remix'

interface IconAdapterContextValue {
  adapter: IconAdapter
  library: IconLibraryName
}

const IconAdapterCtx = createContext<IconAdapterContextValue>({
  adapter: lucideAdapter,
  library: 'lucide',
})

interface IconAdapterProviderProps {
  library: IconLibraryName
  children: React.ReactNode
}

/**
 * Provides the active icon adapter to the panel tree.
 * Defaults to lucide (synchronous, SSR-safe).
 * Alternate adapters load via dynamic import on the client.
 */
export function IconAdapterProvider({ library, children }: IconAdapterProviderProps) {
  const [adapter, setAdapter] = useState<IconAdapter>(lucideAdapter)
  const [activeLibrary, setActiveLibrary] = useState<IconLibraryName>('lucide')

  useEffect(() => {
    if (library === 'lucide' || !library) {
      setAdapter(lucideAdapter)
      setActiveLibrary('lucide')
      return
    }

    // Dynamic import of alternate adapters
    const loaders: Record<string, () => Promise<{ adapter: IconAdapter }>> = {
      tabler: async () => {
        const mod = await import('./adapters/tabler.js')
        await mod.ensureLoaded()
        return { adapter: mod.tablerAdapter }
      },
      phosphor: async () => {
        const mod = await import('./adapters/phosphor.js')
        await mod.ensureLoaded()
        return { adapter: mod.phosphorAdapter }
      },
      remix: async () => {
        const mod = await import('./adapters/remix.js')
        await mod.ensureLoaded()
        return { adapter: mod.remixAdapter }
      },
    }

    const load = loaders[library]
    if (load) {
      load()
        .then(({ adapter: a }) => {
          setAdapter(a)
          setActiveLibrary(library)
        })
        .catch(() => {
          // Fall back to lucide if library package is not installed
          console.warn(`[panels] Icon library "${library}" not available, falling back to lucide`)
          setAdapter(lucideAdapter)
          setActiveLibrary('lucide')
        })
    }
  }, [library])

  return (
    <IconAdapterCtx.Provider value={{ adapter, library: activeLibrary }}>
      {children}
    </IconAdapterCtx.Provider>
  )
}

/** Hook to access the current icon adapter. */
export function useIconAdapter() {
  return useContext(IconAdapterCtx)
}

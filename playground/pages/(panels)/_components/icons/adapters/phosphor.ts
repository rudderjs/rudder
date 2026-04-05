import { iconMap } from '@rudderjs/panels'
import type { IconAdapter, IconComponent } from '../types.js'

let iconsRecord: Record<string, IconComponent> | null = null
let loadPromise: Promise<void> | null = null

function ensureLoaded(): Promise<void> {
  if (iconsRecord) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = import('@phosphor-icons/react')
      .then((mod) => { iconsRecord = mod as unknown as Record<string, IconComponent> })
      .catch(() => { iconsRecord = {} })
  }
  return loadPromise
}

function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

export const phosphorAdapter: IconAdapter = {
  resolve(name: string): IconComponent | null {
    if (!iconsRecord) return null
    const mapped = iconMap[name]?.phosphor
    if (mapped && iconsRecord[mapped]) return iconsRecord[mapped]
    return iconsRecord[toPascalCase(name)] ?? null
  },

  resolveUser(name: string): IconComponent | null {
    if (!iconsRecord) return null
    return iconsRecord[name] ?? iconsRecord[toPascalCase(name)] ?? null
  },
}

export { ensureLoaded }

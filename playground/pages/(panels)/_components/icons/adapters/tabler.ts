import { iconMap } from '@pilotiq/panels'
import type { IconAdapter, IconComponent } from '../types.js'

let iconsRecord: Record<string, IconComponent> | null = null
let loadPromise: Promise<void> | null = null

function ensureLoaded(): Promise<void> {
  if (iconsRecord) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = import('@tabler/icons-react')
      .then((mod) => { iconsRecord = mod as unknown as Record<string, IconComponent> })
      .catch(() => { iconsRecord = {} })
  }
  return loadPromise
}

function toPascalCase(name: string): string {
  return 'Icon' + name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

export const tablerAdapter: IconAdapter = {
  resolve(name: string): IconComponent | null {
    if (!iconsRecord) return null
    const mapped = iconMap[name]?.tabler
    if (mapped && iconsRecord[mapped]) return iconsRecord[mapped]
    return iconsRecord[toPascalCase(name)] ?? null
  },

  resolveUser(name: string): IconComponent | null {
    if (!iconsRecord) return null
    // Try: exact match, then Icon-prefixed PascalCase
    return iconsRecord[name] ?? iconsRecord[toPascalCase(name)] ?? null
  },
}

export { ensureLoaded }

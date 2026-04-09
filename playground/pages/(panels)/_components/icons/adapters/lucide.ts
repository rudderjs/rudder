import { icons } from 'lucide-react'
import { iconMap } from '@pilotiq/panels'
import type { IconAdapter, IconComponent } from '../types.js'

const iconsRecord = icons as unknown as Record<string, IconComponent>

function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

export const lucideAdapter: IconAdapter = {
  resolve(name: string): IconComponent | null {
    const mapped = iconMap[name]?.lucide
    if (mapped && iconsRecord[mapped]) return iconsRecord[mapped]
    // Fallback: try PascalCase conversion
    return iconsRecord[toPascalCase(name)] ?? null
  },

  resolveUser(name: string): IconComponent | null {
    // User icons: try exact match, then PascalCase
    return iconsRecord[name] ?? iconsRecord[toPascalCase(name)] ?? null
  },
}

import { useState, useEffect } from 'react'

type IconComponent = React.ComponentType<{ className?: string }>

// Module-level cache — icons are loaded once on first use.
let iconsCache: Record<string, IconComponent> | null = null
let loadPromise: Promise<void> | null = null

function loadIcons(): Promise<void> {
  if (iconsCache) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = import('lucide-react').then((mod) => {
      iconsCache = mod.icons as Record<string, IconComponent>
    }).catch(() => {
      iconsCache = {}
    })
  }
  return loadPromise
}

function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

interface ResourceIconProps {
  icon: string | undefined
  className?: string
}

/**
 * Renders a resource icon. Supports three formats:
 *
 * - Lucide icon name: `"users"`, `"file-text"`, `"ShoppingCart"`
 *   PascalCase and kebab-case both work.
 *
 * - Inline SVG: `"<svg ...>...</svg>"`
 *   Rendered via dangerouslySetInnerHTML.
 *
 * - Emoji / plain text: `"📦"`, `"✨"`
 *   Rendered as-is in a span.
 */
export function ResourceIcon({ icon: rawIcon, className = 'size-4' }: ResourceIconProps) {
  const icon = rawIcon?.trim()
  const [LucideIcon, setLucideIcon] = useState<IconComponent | null>(() => {
    if (!icon || icon.startsWith('<svg') || /[^\x00-\x7F]/.test(icon)) return null // eslint-disable-line no-control-regex
    if (iconsCache) return iconsCache[toPascalCase(icon)] ?? null
    return null
  })

  useEffect(() => {
    if (!icon || icon.startsWith('<svg') || /[^\x00-\x7F]/.test(icon)) return // eslint-disable-line no-control-regex
    const pascalName = toPascalCase(icon)
    if (iconsCache) {
      setLucideIcon(() => iconsCache?.[pascalName] ?? null)
      return
    }
    loadIcons().then(() => {
      setLucideIcon(() => (iconsCache?.[pascalName]) ?? null)
    }).catch(() => {})
  }, [icon])

  if (!icon) return null

  if (icon.startsWith('<svg')) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: icon }} />
  }

  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(icon)) {
    return <span className={className}>{icon}</span>
  }

  if (LucideIcon) {
    return <LucideIcon className={className} />
  }

  // Empty placeholder while loading — prevents text flash
  return <span className={className} />
}

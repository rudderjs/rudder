import { icons } from 'lucide-react'

type IconComponent = React.ComponentType<{ className?: string }>

const iconsMap = icons as unknown as Record<string, IconComponent>

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
 * Renders a resource icon. SSR-safe — icons resolve synchronously.
 *
 * Supports three formats:
 * - Lucide icon name: `"users"`, `"file-text"`, `"ShoppingCart"`
 * - Inline SVG: `"<svg ...>...</svg>"`
 * - Emoji / plain text: `"📦"`, `"✨"`
 */
export function ResourceIcon({ icon: rawIcon, className = 'size-4' }: ResourceIconProps) {
  const icon = rawIcon?.trim()
  if (!icon) return null

  if (icon.startsWith('<svg')) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: icon }} />
  }

  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(icon)) {
    return <span className={className}>{icon}</span>
  }

  const LucideIcon = iconsMap[toPascalCase(icon)]
  if (LucideIcon) {
    return <LucideIcon className={className} />
  }

  return <span className={className} />
}

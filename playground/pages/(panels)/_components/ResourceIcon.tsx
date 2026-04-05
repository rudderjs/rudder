import { useIconAdapter } from './icons/IconAdapterContext.js'

interface ResourceIconProps {
  icon: string | undefined
  className?: string
}

/**
 * Renders a resource icon. SSR-safe — defaults to lucide.
 *
 * Supports three formats:
 * - Icon name: `"users"`, `"file-text"`, `"ShoppingCart"` (resolved via active icon adapter)
 * - Inline SVG: `"<svg ...>...</svg>"`
 * - Emoji / plain text: `"📦"`, `"✨"`
 */
export function ResourceIcon({ icon: rawIcon, className = 'size-4' }: ResourceIconProps) {
  const { adapter } = useIconAdapter()
  const icon = rawIcon?.trim()
  if (!icon) return null

  if (icon.startsWith('<svg')) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: icon }} />
  }

  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(icon)) {
    return <span className={className}>{icon}</span>
  }

  const Icon = adapter.resolveUser(icon)
  if (Icon) {
    return <Icon className={className} />
  }

  return <span className={className} />
}

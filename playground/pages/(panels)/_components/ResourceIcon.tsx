import { icons } from 'lucide-react'

interface ResourceIconProps {
  icon: string | undefined
  className?: string
}

/**
 * Convert a kebab-case or camelCase icon name to PascalCase.
 * e.g. "file-text" → "FileText", "shoppingCart" → "ShoppingCart", "Users" → "Users"
 */
function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
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
export function ResourceIcon({ icon, className = 'size-4' }: ResourceIconProps) {
  if (!icon) return null

  // Inline SVG
  if (icon.startsWith('<svg')) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: icon }} />
  }

  // Emoji or other non-ASCII — render as text
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(icon)) {
    return <span className={className}>{icon}</span>
  }

  // Lucide icon lookup (PascalCase or kebab-case)
  const pascalName = toPascalCase(icon)
  const LucideIcon = (icons as Record<string, React.ComponentType<{ className?: string }>>)[pascalName]
  if (LucideIcon) {
    return <LucideIcon className={className} />
  }

  // Fallback: render as text
  return <span className={className}>{icon}</span>
}

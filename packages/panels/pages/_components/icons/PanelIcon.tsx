import { useIconAdapter } from './IconAdapterContext.js'

interface PanelIconProps {
  /** Canonical icon name (kebab-case), e.g. 'chevron-right', 'log-out' */
  name: string
  className?: string
}

/**
 * Panel-internal icon component. Uses the active icon adapter to resolve
 * canonical icon names to the correct library component.
 *
 * For user-specified resource icons, use `ResourceIcon` instead.
 */
export function PanelIcon({ name, className = 'size-4' }: PanelIconProps) {
  const { adapter } = useIconAdapter()
  const Icon = adapter.resolve(name)
  if (!Icon) return <span className={className} />
  return <Icon className={className} />
}

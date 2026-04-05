export type IconComponent = React.ComponentType<{ className?: string; size?: number }>

/**
 * Icon adapter interface — abstracts icon resolution across libraries.
 * Each adapter knows how to resolve canonical icon names to components.
 */
export interface IconAdapter {
  /** Resolve a canonical icon name (e.g. 'chevron-right') to a React component. */
  resolve(name: string): IconComponent | null
  /** Resolve a user-specified icon name (e.g. 'FileText', 'users') — best-effort PascalCase lookup. */
  resolveUser(name: string): IconComponent | null
}

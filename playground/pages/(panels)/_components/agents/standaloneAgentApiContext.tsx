'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * React context for the standalone-agent API parameters needed by field
 * input components that render their own inline AI surfaces (the floating
 * `✦` / `💬` buttons in `panels-lexical` `FloatingToolbarPlugin` and
 * `SelectionAiPlugin`, which delegate to `AiDropdown` rendered by the field
 * input component).
 *
 * Why a context: the standalone agent endpoint params (`apiBase`,
 * `resourceSlug`, `recordId`) are known at the form/page level, but they
 * need to be available deep inside individual field input components — only
 * when those components render an inline AI surface. Threading them through
 * `FieldInputProps` would require touching every field input component
 * (15+ files) for props that 95% of them ignore.
 *
 * Provided by `SchemaRenderer` when AI surfaces are enabled (edit mode with
 * the standalone API params known); consumed by `RichContentInput` /
 * `TextInput` (collab path) / `TextareaInput` (collab path) — the only
 * components that render their own inline trigger.
 *
 * `null` means "no standalone API context configured" — the consuming field
 * component should treat that as "AI inline surfaces disabled" and not
 * render the floating menu.
 */
export interface PanelAgentApiContextValue {
  apiBase:      string
  resourceSlug: string
  recordId:     string
}

const PanelAgentApiContext = createContext<PanelAgentApiContextValue | null>(null)

export function PanelAgentApiProvider({
  value,
  children,
}: {
  value: PanelAgentApiContextValue | null
  children: ReactNode
}) {
  return (
    <PanelAgentApiContext.Provider value={value}>
      {children}
    </PanelAgentApiContext.Provider>
  )
}

/**
 * Returns the standalone API context, or null if AI surfaces are not
 * enabled on the current form. Field input components should use this to
 * gate their inline AI menu rendering.
 */
export function usePanelAgentApi(): PanelAgentApiContextValue | null {
  return useContext(PanelAgentApiContext)
}

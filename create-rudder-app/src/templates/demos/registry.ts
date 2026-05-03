import type { TemplateContext } from '../../templates.js'

export interface DemoSpec {
  value:        string
  label:        string
  hint?:        string
  /** Package keys that must all be selected for this demo to scaffold. */
  requires?:    ReadonlyArray<keyof TemplateContext['packages']>
  /** True if this demo requires a database/ORM. */
  requiresOrm?: boolean
}

export const DEMOS: ReadonlyArray<DemoSpec> = [
  { value: 'contact', label: 'Contact form',      hint: 'CSRF + Zod validation' },
  { value: 'ws',      label: 'WebSocket chat',    hint: 'requires WebSocket / Broadcast', requires: ['broadcast'] },
  { value: 'live',    label: 'Yjs collaboration', hint: 'requires Sync',                  requires: ['sync'] },
]

export function availableDemos(
  orm: TemplateContext['orm'],
  packages: TemplateContext['packages'],
): DemoSpec[] {
  return DEMOS.filter(d => {
    if (d.requiresOrm && orm === false) return false
    if (d.requires) return d.requires.every(p => packages[p])
    return true
  })
}

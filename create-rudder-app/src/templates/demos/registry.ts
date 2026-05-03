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
  { value: 'contact',       label: 'Contact form',      hint: 'CSRF + Zod validation' },
  { value: 'cache',         label: 'Cache counter',     hint: 'Cache.get + Cache.set round-trip' },
  { value: 'todos',         label: 'Todos CRUD',        hint: 'requires ORM',                   requiresOrm: true },
  { value: 'queue',         label: 'Queue dispatch',    hint: 'requires Queue',                 requires: ['queue'] },
  { value: 'mail',          label: 'Mail send',         hint: 'requires Mail',                  requires: ['mail'] },
  { value: 'notifications', label: 'Notifications',     hint: 'requires Notifications + Mail',  requires: ['notifications', 'mail'] },
  { value: 'localization',  label: 'Localization',      hint: 'requires Localization',          requires: ['localization'] },
  { value: 'http',          label: 'HTTP client',       hint: 'requires HTTP',                  requires: ['http'] },
  { value: 'avatar',        label: 'Avatar resize',     hint: 'requires Storage + Image',       requires: ['storage', 'image'] },
  { value: 'fibonacci',     label: 'Worker threads',    hint: 'requires Concurrency',           requires: ['concurrency'] },
  { value: 'system-info',   label: 'System info',       hint: 'requires Process',               requires: ['process'] },
  { value: 'pennant',       label: 'Feature flags',     hint: 'requires Pennant + Auth',        requires: ['pennant', 'auth'] },
  { value: 'ws',            label: 'WebSocket chat',    hint: 'requires WebSocket / Broadcast', requires: ['broadcast'] },
  { value: 'sync',          label: 'Yjs collaboration', hint: 'requires Sync',                  requires: ['sync'] },
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

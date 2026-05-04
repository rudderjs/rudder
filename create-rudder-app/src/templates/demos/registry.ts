import type { TemplateContext } from '../../templates.js'

export interface DemoSpec {
  /** Stable id used in URLs, file names, and the prompt multiselect. */
  value:        string
  /** Short label shown in the @clack/prompts multiselect. */
  label:        string
  /** Single-line hint shown next to the label in the prompt. */
  hint?:        string
  /** Card title shown on /demos. Falls back to `label` when omitted. */
  title?:       string
  /** Long description shown on the /demos card in the scaffolded app + playground. */
  description:  string
  /** Packages this demo exercises — rendered under each /demos card. */
  packages:     ReadonlyArray<string>
  /** Package keys that must all be selected for this demo to scaffold. */
  requires?:    ReadonlyArray<keyof TemplateContext['packages']>
  /** True if this demo requires a database/ORM. */
  requiresOrm?: boolean
}

/** Card title used on /demos — falls back to `label` when not overridden. */
export function demoTitle(spec: DemoSpec): string {
  return spec.title ?? spec.label
}

export const DEMOS: ReadonlyArray<DemoSpec> = [
  {
    value:       'contact',
    label:       'Contact form',
    hint:        'CSRF + Zod validation',
    description: 'CSRF-protected form with Zod validation. Demonstrates getCsrfToken() and FormRequest-style error handling.',
    packages:    ['@rudderjs/middleware', '@rudderjs/core'],
  },
  {
    value:       'cache',
    label:       'Cache counter',
    hint:        'Cache.get + Cache.set round-trip',
    description: 'Click "Bump" to read the current value via Cache.get, increment it, and write it back via Cache.set. Default driver is in-memory.',
    packages:    ['@rudderjs/cache'],
  },
  {
    value:       'todos',
    label:       'Todos CRUD',
    title:       'Todos',
    hint:        'requires ORM',
    description: 'ORM + interactive UI. Controller loads initial data, the view hydrates and POSTs to /api/todos/* for live updates.',
    packages:    ['@rudderjs/orm', '@rudderjs/router'],
    requiresOrm: true,
  },
  {
    value:       'polymorphic',
    label:       'Polymorphic relations',
    hint:        'requires ORM',
    description: 'morphMany + morphTo + morphToMany / morphedByMany via @rudderjs/orm. One Comment table belongs to either a Post or a Video; Posts and Videos share a Tag table through a single polymorphic pivot. End-to-end demo of every polymorphic relation type.',
    packages:    ['@rudderjs/orm'],
    requiresOrm: true,
  },
  {
    value:       'queue',
    label:       'Queue dispatch',
    hint:        'requires Queue',
    description: 'Dispatch ExampleJob via @rudderjs/queue. The handler logs to the server terminal — install @rudderjs/horizon for a UI.',
    packages:    ['@rudderjs/queue'],
    requires:    ['queue'],
  },
  {
    value:       'mail',
    label:       'Mail send',
    hint:        'requires Mail',
    description: 'Send a DemoMail via @rudderjs/mail. Default driver is log — output lands in the dev server terminal.',
    packages:    ['@rudderjs/mail'],
    requires:    ['mail'],
  },
  {
    value:       'notifications',
    label:       'Notifications',
    hint:        'requires Notifications + Mail',
    description: "Dispatch a WelcomeNotification via notify(). The notification's via() picks the channel(s); mail routes through the log driver.",
    packages:    ['@rudderjs/notification', '@rudderjs/mail'],
    requires:    ['notifications', 'mail'],
  },
  {
    value:       'localization',
    label:       'Localization',
    hint:        'requires Localization',
    description: 'Locale switcher resolves the same keys server-side via trans(). Strings live in lang/<locale>/messages.json.',
    packages:    ['@rudderjs/localization'],
    requires:    ['localization'],
  },
  {
    value:       'http',
    label:       'HTTP client',
    hint:        'requires HTTP',
    description: 'Server-side Http.retry(3, 200).timeout(5000).get(url) against a public API. The 500 endpoint exercises the retry path.',
    packages:    ['@rudderjs/http'],
    requires:    ['http'],
  },
  {
    value:       'avatar',
    label:       'Avatar resize',
    hint:        'requires Storage + Image',
    description: 'Upload an image — server resizes it to 256×256 WebP via @rudderjs/image and saves to public storage. Side-by-side compare.',
    packages:    ['@rudderjs/image', '@rudderjs/storage'],
    requires:    ['storage', 'image'],
  },
  {
    value:       'fibonacci',
    label:       'Worker threads',
    hint:        'requires Concurrency',
    description: 'Compute fib(n) sequentially on the main thread vs across @rudderjs/concurrency worker pool. Watch the parallel cost stay flat as you crank N.',
    packages:    ['@rudderjs/concurrency'],
    requires:    ['concurrency'],
  },
  {
    value:       'system-info',
    label:       'System info',
    hint:        'requires Process',
    description: 'Three shell commands (git, node, uptime) executed via @rudderjs/process. Compares sequential vs parallel cost using Process.pool().',
    packages:    ['@rudderjs/process'],
    requires:    ['process'],
  },
  {
    value:       'pennant',
    label:       'Feature flags',
    hint:        'requires Pennant + Auth',
    description: 'Boolean, value, scoped, and Lottery features resolved against the current user. Sub-route guarded by FeatureMiddleware to demonstrate 403 blocking.',
    packages:    ['@rudderjs/pennant'],
    requires:    ['pennant', 'auth'],
  },
  {
    value:       'ws',
    label:       'WebSocket chat',
    hint:        'requires WebSocket / Broadcast',
    description: 'Real-time chat + presence using @rudderjs/broadcast — multi-channel pub/sub over a single WebSocket connection.',
    packages:    ['@rudderjs/broadcast'],
    requires:    ['broadcast'],
  },
  {
    value:       'sync',
    label:       'Yjs collaboration',
    title:       'Collaborative editor',
    hint:        'requires Sync',
    description: 'Yjs CRDT live document with awareness cursors. Open in two tabs to see real-time sync over @rudderjs/sync.',
    packages:    ['@rudderjs/sync'],
    requires:    ['sync'],
  },
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

/** Default href for a demo card — `/demos/<value>`. */
export function demoHref(spec: Pick<DemoSpec, 'value'>): string {
  return `/demos/${spec.value}`
}

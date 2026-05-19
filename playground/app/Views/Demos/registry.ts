// Demo catalog for playground's `/demos` index. Each entry maps to a view
// file in this directory (`app/Views/Demos/<Name>.tsx`) and a matching
// controller route in `routes/web.ts` / `routes/api.ts`.
//
// Previously lived under `create-rudder-app/src/templates/demos/registry.ts`
// when the scaffolder shipped demo templates. Demos now live in playground
// only — this file is the source of truth.

export interface DemoSpec {
  /** Stable id used in URLs + view ids. */
  value:        string
  /** Card label shown on /demos. */
  label:        string
  /** Optional override for the card title (defaults to `label`). */
  title?:       string
  /** Long description shown on the /demos card. */
  description:  string
  /** Packages this demo exercises — rendered under each /demos card. */
  packages:     ReadonlyArray<string>
}

/** Card title used on /demos — falls back to `label` when not overridden. */
export function demoTitle(spec: DemoSpec): string {
  return spec.title ?? spec.label
}

/** Default href for a demo card — `/demos/<value>`. */
export function demoHref(spec: Pick<DemoSpec, 'value'>): string {
  return `/demos/${spec.value}`
}

export const DEMOS: ReadonlyArray<DemoSpec> = [
  {
    value:       'contact',
    label:       'Contact form',
    description: 'CSRF-protected form with Zod validation. Demonstrates getCsrfToken() and FormRequest-style error handling.',
    packages:    ['@rudderjs/middleware', '@rudderjs/core'],
  },
  {
    value:       'cache',
    label:       'Cache counter',
    description: 'Click "Bump" to read the current value via Cache.get, increment it, and write it back via Cache.set. Default driver is in-memory.',
    packages:    ['@rudderjs/cache'],
  },
  {
    value:       'todos',
    label:       'Todos CRUD',
    title:       'Todos',
    description: 'ORM + interactive UI. Controller loads initial data, the view hydrates and POSTs to /api/todos/* for live updates.',
    packages:    ['@rudderjs/orm', '@rudderjs/router'],
  },
  {
    value:       'polymorphic',
    label:       'Polymorphic relations',
    description: 'morphMany + morphTo + morphToMany / morphedByMany via @rudderjs/orm. One Comment table belongs to either a Post or a Video; Posts and Videos share a Tag table through a single polymorphic pivot. End-to-end demo of every polymorphic relation type.',
    packages:    ['@rudderjs/orm'],
  },
  {
    value:       'queue',
    label:       'Queue dispatch',
    description: 'Dispatch ExampleJob via @rudderjs/queue. The handler logs to the server terminal — install @rudderjs/horizon for a UI.',
    packages:    ['@rudderjs/queue'],
  },
  {
    value:       'mail',
    label:       'Mail send',
    description: 'Send a DemoMail via @rudderjs/mail. Default driver is log — output lands in the dev server terminal.',
    packages:    ['@rudderjs/mail'],
  },
  {
    value:       'notifications',
    label:       'Notifications',
    description: "Dispatch a WelcomeNotification via notify(). The notification's via() picks the channel(s); mail routes through the log driver.",
    packages:    ['@rudderjs/notification', '@rudderjs/mail'],
  },
  {
    value:       'localization',
    label:       'Localization',
    description: 'Locale switcher resolves the same keys server-side via trans(). Strings live in lang/<locale>/messages.json.',
    packages:    ['@rudderjs/localization'],
  },
  {
    value:       'http',
    label:       'HTTP client',
    description: 'Server-side Http.retry(3, 200).timeout(5000).get(url) against a public API. The 500 endpoint exercises the retry path.',
    packages:    ['@rudderjs/http'],
  },
  {
    value:       'avatar',
    label:       'Avatar resize',
    description: 'Upload an image — server resizes it to 256×256 WebP via @rudderjs/image and saves to public storage. Side-by-side compare.',
    packages:    ['@rudderjs/image', '@rudderjs/storage'],
  },
  {
    value:       'fibonacci',
    label:       'Worker threads',
    description: 'Compute fib(n) sequentially on the main thread vs across @rudderjs/concurrency worker pool. Watch the parallel cost stay flat as you crank N.',
    packages:    ['@rudderjs/concurrency'],
  },
  {
    value:       'system-info',
    label:       'System info',
    description: 'Three shell commands (git, node, uptime) executed via @rudderjs/process. Compares sequential vs parallel cost using Process.pool().',
    packages:    ['@rudderjs/process'],
  },
  {
    value:       'pennant',
    label:       'Feature flags',
    description: 'Boolean, value, scoped, and Lottery features resolved against the current user. Sub-route guarded by FeatureMiddleware to demonstrate 403 blocking.',
    packages:    ['@rudderjs/pennant'],
  },
  {
    value:       'ws',
    label:       'WebSocket chat',
    description: 'Real-time chat + presence using @rudderjs/broadcast — multi-channel pub/sub over a single WebSocket connection.',
    packages:    ['@rudderjs/broadcast'],
  },
  {
    value:       'sync',
    label:       'Yjs collaboration',
    title:       'Collaborative editor',
    description: 'Yjs CRDT live document with awareness cursors. Open in two tabs to see real-time sync over @rudderjs/sync.',
    packages:    ['@rudderjs/sync'],
  },
]

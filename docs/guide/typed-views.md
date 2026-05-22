# Typed Views

`view('id', props)` type-checks the props you pass against the receiving component. Mismatches fail at the controller, not at render time.

```ts
// routes/web.ts
Route.get('/dashboard', async () => view('dashboard', {
  user: { id: 1, name: 'Suleiman' },
  // forgot a required prop, or passed the wrong shape?
  // tsc fails right here.
}))
```

The convention is one line of code in the view file. Apps that don't opt in keep working unchanged.

## The convention

Export `Props` from your view component:

```tsx
// app/Views/Dashboard.tsx
export interface Props {
  user:  { id: number; name: string }
  posts: { id: number; title: string }[]
}

export default function Dashboard({ user, posts }: Props) {
  return (
    <main>
      <h1>Hello, {user.name}</h1>
      <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </main>
  )
}
```

That's it. `@rudderjs/vite`'s views scanner picks up the `Props` export on its next scan and wires it into a per-app registry. The next `view('dashboard', ...)` call type-checks against that exact shape.

`export type Props = { ... }` works identically — interface and type alias are both detected.

## What you get

- **Type-checked controllers.** Passing the wrong shape, missing a required prop, or sneaking in an extra field fails `pnpm typecheck`.
- **Intellisense at the call site.** Editors complete prop names as you type the second argument to `view()`.
- **Typed `pageContext.viewProps`.** Read inside the view component (or any Vike hook), `pageContext.viewProps` narrows to the union of registered prop shapes.
- **No codegen step to remember.** The scanner regenerates the registry on every dev scan and at build time. There's no `pnpm rudder view:types` to run.

## Opt-in per view

Views without an exported `Props` keep the loose behavior — `view('id', props)` accepts any `Record<string, unknown>` for the props argument, just like before. You can adopt the convention one view at a time.

When you mix typed and untyped views, the registry only contains the typed ones. Calls to typed view ids fail compile if the shape is wrong; calls to untyped ids fall through to the loose overload.

## Multi-framework support

The convention works across React, Solid, and Vue. The scanner reads view source files as plain text — it doesn't need a TS AST — so the same `export interface Props` line in a Vue SFC's `<script lang="ts">` block is picked up identically.

Vanilla views (HTML-string functions) are intentionally excluded — they take their props as a typed function argument already, so the call-site type check happens through normal function-arg inference without needing a registry.

```vue
<!-- app/Views/Profile.vue -->
<script lang="ts">
export interface Props {
  user: { id: number; name: string }
}
</script>
<script setup lang="ts">
defineProps<Props>()
</script>
<template>
  <h1>Hello, {{ user.name }}</h1>
</template>
```

::: tip Vue note
Vue SFCs reject `export` statements inside `<script setup>` — put the `Props` export in a regular `<script lang="ts">` block alongside `<script setup>`. The same constraint applies to the `export const route` URL override.
:::

## How it works

When the views scanner discovers an `export interface Props` (or `export type Props`) in a view file, it adds one line to a generated declaration file:

```ts
// pages/__view/registry.d.ts — AUTO-GENERATED, gitignored
declare module '@rudderjs/view' {
  interface ViewPropsRegistry {
    'dashboard': import('App/Views/Dashboard.tsx').Props
    'admin.users': import('App/Views/Admin/Users.tsx').Props
  }
}
```

`@rudderjs/view` declares `ViewPropsRegistry` as an empty interface. Each generated entry above augments it via TypeScript's module-augmentation mechanism. `view()` exposes a typed overload constrained over `keyof ViewPropsRegistry`, so once an id is in the registry, the props argument must match the registered shape.

The `import('...').Props` form is a deferred type reference — tsc resolves it only when checking a `view(<id>, ...)` call site. A missing or moved view file surfaces as a targeted error on the affected call, not a registry-wide compile break.

## Migration

For an existing view, add the `Props` export:

```diff
  // app/Views/Settings.tsx
- interface SettingsProps {
+ export interface Props {
    user: User
    notifications: Notification[]
  }

- export default function Settings({ user, notifications }: SettingsProps) {
+ export default function Settings({ user, notifications }: Props) {
    /* ... */
  }
```

Run `pnpm dev` (or `pnpm build`) once — the scanner regenerates `pages/__view/registry.d.ts`, and the corresponding `view('settings', ...)` calls are now type-checked.

## Comparison

This is Rudder's equivalent of Inertia's prop typing or Nuxt's typed `useFetch` — but without a separate generator step or a `.d.ts` file you have to remember to refresh. The scanner is already running to discover views; the registry falls out of the same scan.

## Limitations

- **Empty `Props` interfaces compile.** `export interface Props {}` registers an empty object type. Documented as a developer choice; not enforced.
- **Vue inline prop types are not picked up.** `defineProps<{ x: string }>()` inside `<script setup>` is invisible to the regex-based scanner. Use the named `Props` convention to opt in.
- **`exactOptionalPropertyTypes`** is enabled in the base tsconfig. A view typed as `{ count?: number }` rejects `{ count: undefined }` at the call site — pass `{}` instead, or set the property to a real value.

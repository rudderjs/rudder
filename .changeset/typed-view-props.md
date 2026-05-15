---
'@rudderjs/view': minor
'@rudderjs/vite': minor
---

Typed views: `view('id', props)` now type-checks against the receiving component's exported `Props` type. Opt in per view by adding `export interface Props` (or `export type Props`) to the view file — the scanner emits `pages/__view/registry.d.ts` mapping the id to the prop shape, and the controller call site is checked at compile time. Apps that don't adopt the convention keep working unchanged; the loose `view(id, props?)` overload still accepts any record-shaped props. Stubs for React / Solid / Vue `+Page` files use the per-view `Props` type when available so intellisense propagates into the rendered component. Vanilla views are intentionally excluded (their props are typed at the function argument already).

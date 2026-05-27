import type { PageContext } from 'vike/types'

// Default document <title> for every page. A controller sets a per-page title
// by passing one in the view props — `view('dashboard', { title: 'Dashboard' })`
// — which arrives here on pageContext.viewProps. Must be a separate +title.ts
// file: vike rejects a function `title` inline in +config.ts ("runtime in
// config"). viewProps is passed to the client, so this is browser-safe.
export default function title(pageContext: PageContext): string {
  const t = (pageContext as { viewProps?: { title?: string } }).viewProps?.title
  return t ? `${t} · Rudder` : 'Rudder'
}

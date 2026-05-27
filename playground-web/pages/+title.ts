import type { PageContext } from 'vike/types'

// Default document <title>; controllers override per page via
// `view('id', { title: '...' })` → arrives on pageContext.viewProps. Must be a
// separate +title.ts file: vike rejects a function `title` inline in +config.ts.
export default function title(pageContext: PageContext): string {
  const t = (pageContext as { viewProps?: { title?: string } }).viewProps?.title
  return t ? `${t} · Rudder` : 'Rudder'
}

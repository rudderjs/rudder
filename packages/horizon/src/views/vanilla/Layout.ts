import { html, raw } from './_html.js'

/**
 * Shared HTML chrome for Horizon dashboard pages.
 *
 * Vanilla mode (raw template literals + Alpine.js + Tailwind via CDN). No
 * client framework dependency, no build step. The package's UI is fully
 * self-contained so horizon can monitor a host app of any framework.
 */

export interface NavItem {
  label: string
  path:  string
  icon:  string
}

export interface LayoutProps {
  title:      string
  body:       string
  basePath:   string
  activePath: string
}

export function Layout(props: LayoutProps): string {
  const { title, body, basePath, activePath } = props

  const nav: NavItem[] = [
    { label: 'Dashboard',    path: '',              icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { label: 'Recent Jobs',  path: '/jobs/recent',  icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { label: 'Failed Jobs',  path: '/jobs/failed',  icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    { label: 'Queues',       path: '/queues',       icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
    { label: 'Workers',      path: '/workers',      icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  ]

  const navHtml = nav.map(n => {
    const href   = `${basePath}${n.path}`
    const active = activePath === n.path || (n.path === '' && activePath === '/')
    return html`<a href="${href}" class="${raw(`flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition ${active ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`)}">
      ${raw(`<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${n.icon}"/></svg>`)}
      ${n.label}
    </a>`
  })

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Horizon</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>[x-cloak] { display: none !important; }</style>
</head>
<body class="bg-gray-50 text-gray-900 font-sans antialiased">
  <div class="flex min-h-screen">
    <aside class="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div class="px-4 py-5 flex items-center gap-2 border-b border-gray-100">
        <div class="w-7 h-7 bg-teal-600 rounded-lg flex items-center justify-center">
          ${raw('<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>')}
        </div>
        <span class="font-semibold text-sm">Horizon</span>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        ${navHtml}
      </nav>
    </aside>
    <main class="flex-1 overflow-auto">
      <div class="max-w-6xl mx-auto px-6 py-8">
        ${raw(body)}
      </div>
    </main>
  </div>
</body>
</html>`.value
}

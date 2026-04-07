/**
 * Shared HTML layout for Telescope UI pages.
 * Sidebar navigation + content area. Alpine.js + Tailwind CDN.
 */

export interface NavItem {
  label: string
  path:  string
  icon:  string
}

export function layout(title: string, body: string, basePath: string, activePath: string): string {
  const nav: NavItem[] = [
    { label: 'Dashboard',     path: '',              icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { label: 'Requests',      path: '/requests',     icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { label: 'Queries',       path: '/queries',      icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' },
    { label: 'Jobs',          path: '/jobs',         icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { label: 'Exceptions',    path: '/exceptions',   icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    { label: 'Logs',          path: '/logs',         icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { label: 'Mail',          path: '/mail',         icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { label: 'Notifications', path: '/notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    { label: 'Events',        path: '/events',       icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { label: 'Cache',         path: '/cache',        icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
    { label: 'Schedule',      path: '/schedule',     icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { label: 'Models',        path: '/models',       icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  ]

  const navHtml = nav.map(n => {
    const href   = `${basePath}${n.path}`
    const active = activePath === n.path || (n.path === '' && activePath === '/')
    return `<a href="${href}" class="flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition ${active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${n.icon}"/></svg>
      ${n.label}
    </a>`
  }).join('\n        ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Telescope</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    [x-cloak] { display: none !important; }
    .badge { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900 font-sans antialiased">
  <div class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div class="px-4 py-5 flex items-center gap-2 border-b border-gray-100">
        <div class="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
          </svg>
        </div>
        <span class="font-semibold text-sm">Telescope</span>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        ${navHtml}
      </nav>
    </aside>

    <!-- Main content -->
    <main class="flex-1 overflow-auto">
      <div class="max-w-6xl mx-auto px-6 py-8">
        ${body}
      </div>
    </main>
  </div>
</body>
</html>`
}

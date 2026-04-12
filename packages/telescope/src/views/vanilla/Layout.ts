/**
 * Shared HTML chrome for Telescope dashboard pages.
 *
 * Vanilla mode (raw template literals + Alpine.js + Tailwind via CDN). No
 * client framework dependency, no build step. The package's UI is fully
 * self-contained so telescope can debug a host app of any framework.
 *
 * SPA navigation: the `telescopeSpa()` Alpine component intercepts internal
 * link clicks, fetches the target page via `fetch()`, swaps the `<main>`
 * content, and pushes to `history.pushState()`. The sidebar never reloads.
 * Back/forward buttons work via `popstate`. External links fall through.
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
    { label: 'Commands',      path: '/commands',     icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { label: 'HTTP Client',   path: '/http',         icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9' },
    { label: 'Gates',         path: '/gates',        icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    { label: 'Dumps',         path: '/dumps',        icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
    { label: 'WebSockets',    path: '/broadcasts',   icon: 'M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z' },
    { label: 'Live (Yjs)',    path: '/live',         icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  ]

  // Build nav with Alpine-driven active state
  const navHtml = nav.map(n => {
    const href = `${basePath}${n.path}`
    const pathExpr = n.path === '' ? `'/'` : `'${n.path}'`
    return `<a href="${href}" @click.prevent="navigate('${href}')"
          class="flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition"
          :class="currentPath === ${pathExpr} ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'">
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
  <div x-data="telescopeSpa()" @popstate.window="onPopState()" class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div class="px-4 py-5 flex items-center gap-2 border-b border-gray-100">
        <a href="${basePath}" @click.prevent="navigate('${basePath}')" class="flex items-center gap-2">
          <div class="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          </div>
          <span class="font-semibold text-sm">Telescope</span>
        </a>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        ${navHtml}
      </nav>
    </aside>

    <!-- Main content -->
    <main id="telescope-main" class="flex-1 overflow-auto" @telescope:navigate.window="navigate($event.detail)">
      <div class="max-w-6xl mx-auto px-6 py-8">
        ${body}
      </div>
    </main>
  </div>

  <script>
    function telescopeSpa() {
      const basePath = '${basePath}'
      return {
        currentPath: '${activePath}',

        async navigate(href) {
          // Stop any running auto-refresh timers from the previous page
          this.stopPageTimers()

          try {
            const res = await fetch(href)
            if (!res.ok) { window.location.href = href; return }
            const text = await res.text()
            const doc = new DOMParser().parseFromString(text, 'text/html')
            const newMain = doc.getElementById('telescope-main')
            if (!newMain) { window.location.href = href; return }

            const mainEl = document.getElementById('telescope-main')

            // Tear down old Alpine trees before replacing content
            Alpine.mutateDom(() => {
              mainEl.innerHTML = newMain.innerHTML
            })

            // Execute <script> tags from the swapped content — innerHTML
            // doesn't execute scripts, so we need to manually create and
            // append new <script> elements.
            mainEl.querySelectorAll('script').forEach(oldScript => {
              const newScript = document.createElement('script')
              newScript.textContent = oldScript.textContent
              oldScript.replaceWith(newScript)
            })

            // Now initialize Alpine on the new DOM
            Alpine.initTree(mainEl)

            // Update active path (strip basePath prefix for sidebar matching)
            const url = new URL(href, location.origin)
            const relative = url.pathname.replace(basePath, '') || '/'
            this.currentPath = relative

            // Update browser URL and title
            const newTitle = doc.querySelector('title')
            if (newTitle) document.title = newTitle.textContent
            // Don't push if this was triggered by back/forward
            if (this._isPopState) {
              this._isPopState = false
            } else {
              history.pushState(null, '', href)
            }
          } catch (e) {
            console.error('[Telescope SPA]', e)
            window.location.href = href
          }
        },

        onPopState() {
          this.stopPageTimers()
          // Fetch the page the browser navigated to
          this._isPopState = true
          this.navigate(location.href)
        },

        _isPopState: false,

        stopPageTimers() {
          // Clear any auto-refresh intervals from EntryList pages
          const mainEl = document.getElementById('telescope-main')
          if (mainEl) {
            mainEl.querySelectorAll('[x-data]').forEach(el => {
              if (el._x_dataStack) {
                for (const data of el._x_dataStack) {
                  if (data._refreshTimer) {
                    clearInterval(data._refreshTimer)
                    data._refreshTimer = null
                  }
                }
              }
            })
          }
        }
      }
    }
  </script>
</body>
</html>`
}

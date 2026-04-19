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
    { label: 'AI',           path: '/ai',           icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
    { label: 'MCP',          path: '/mcp',          icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { label: 'Views',         path: '/views',        icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
    { label: 'Live (Yjs)',    path: '/live',         icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  ]

  // Build nav with Alpine-driven active state
  const navHtml = nav.map(n => {
    const href = `${basePath}${n.path}`
    const pathExpr = n.path === '' ? `'/'` : `'${n.path}'`
    return `<a href="${href}" @click.prevent="navigate('${href}')"
          class="flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition"
          :class="currentPath === ${pathExpr} ? 'bg-indigo-50 text-indigo-700 font-medium dark:bg-indigo-950 dark:text-indigo-300' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'">
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
  <script>tailwindcss = { config: { darkMode: 'class' } }</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark')
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      document.documentElement.classList.toggle('dark', e.matches)
    })
  </script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    [x-cloak] { display: none !important; }
    .badge { @apply inline-flex items-center px-2 py-0.5 rounded text-xs font-medium; }
  </style>
</head>
<body class="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans antialiased">
  <div x-data="telescopeSpa()" @popstate.window="onPopState()" class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="border-gray-200 border-r dark:border-gray-800 flex flex-col w-56">
      <div class="border-gray-100 dark:border-gray-800 flex gap-2 items-center px-4 py-5">
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
      <!-- Toolbar -->
      <div class="flex gap-2 items-center justify-end px-6 py-2"
           x-data="telescopeToolbar('${basePath}/api')">
        <button @click="toggleRecording()" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition"
                :class="recording ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-red-50 text-red-700 hover:bg-red-100'">
          <span class="w-2 h-2 rounded-full" :class="recording ? 'bg-green-500' : 'bg-red-500'"></span>
          <span x-text="recording ? 'Recording' : 'Paused'"></span>
        </button>
        <button @click="clearAll()" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          Clear
        </button>
        <button @click="refresh()" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          Refresh
        </button>
      </div>
      <div class="max-w-6xl mx-auto px-6 py-8">
        ${body}
      </div>
    </main>
  </div>

  <script>
    function telescopeToolbar(apiPrefix) {
      return {
        recording: true,
        async init() {
          const data = await fetch(apiPrefix + '/recording').then(r => r.json())
          this.recording = data.recording
        },
        async toggleRecording() {
          const data = await fetch(apiPrefix + '/recording', { method: 'PATCH' }).then(r => r.json())
          this.recording = data.recording
        },
        async clearAll() {
          if (!confirm('Clear all telescope entries?')) return
          await fetch(apiPrefix + '/entries', { method: 'DELETE' })
          this.$dispatch('telescope:navigate', location.href)
        },
        refresh() {
          this.$dispatch('telescope:navigate', location.href)
        }
      }
    }

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

/**
 * Shared HTML layout for Pulse UI pages.
 * Uses Tailwind CSS (CDN) + Alpine.js (CDN) for a zero-build UI.
 */
export function layout(title: string, body: string, path: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Pulse</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    [x-cloak] { display: none !important; }
    .sparkline { display: flex; align-items: end; gap: 1px; height: 40px; }
    .sparkline .bar { flex: 1; background: #6366f1; border-radius: 1px; min-width: 2px; transition: height 0.3s; }
    .sparkline .bar:hover { background: #818cf8; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900 font-sans antialiased">
  <div class="min-h-screen">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 px-6 py-4">
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <h1 class="text-lg font-semibold">Pulse</h1>
        </div>
        <div x-data="{ period: new URLSearchParams(location.search).get('period') || '1h' }">
          <select x-model="period" @change="location.search = '?period=' + period"
                  class="text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 px-3 py-1.5 border">
            <option value="1h">Last hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
        </div>
      </div>
    </header>

    <!-- Content -->
    <main class="max-w-7xl mx-auto px-6 py-8">
      ${body}
    </main>
  </div>
</body>
</html>`
}

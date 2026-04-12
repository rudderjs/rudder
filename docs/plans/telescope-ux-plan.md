---
status: not started
created: 2026-04-12
---

# Plan: Telescope UX — SPA Navigation + Laravel-Parity Detail Pages

## Overview

Two workstreams that can ship independently:

1. **Alpine SPA navigation** — intercept link clicks, fetch+swap `<main>` content, `history.pushState()`. No full page reloads when navigating between telescope pages.
2. **Detail page improvements** — tabbed sections, inline related entries, more request metadata, better formatting. Brings detail pages to Laravel Telescope parity.

---

## Phase 1 — Alpine SPA Navigation (~30min)

### How it works

The `Layout.ts` sidebar + header stays static. When a sidebar link or any internal telescope link is clicked:

1. Alpine intercepts the click (`@click.prevent`)
2. `fetch(href)` loads the target page's full HTML
3. Parse the response, extract just the `<main>` inner content
4. Swap current `<main>` content with the new content
5. `history.pushState(null, '', href)` updates the URL
6. Update the sidebar active state
7. Listen for `popstate` to handle back/forward

### Implementation

**`Layout.ts`** — wrap the whole page in an Alpine component:

```html
<body x-data="telescopeApp()" @popstate.window="navigate(location.pathname)">
  <div class="flex min-h-screen">
    <aside>
      <!-- Sidebar links get @click.prevent="navigate(href)" -->
      <a :href="href" @click.prevent="navigate(href)" ...>
    </aside>
    <main id="telescope-main">
      ${body}
    </main>
  </div>
</body>

<script>
function telescopeApp() {
  return {
    currentPath: window.location.pathname,

    async navigate(href) {
      try {
        const res = await fetch(href)
        const html = await res.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const newMain = doc.getElementById('telescope-main')
        if (newMain) {
          document.getElementById('telescope-main').innerHTML = newMain.innerHTML
          // Re-init Alpine on the swapped content
          Alpine.initTree(document.getElementById('telescope-main'))
        }
        this.currentPath = new URL(href, location.origin).pathname
        history.pushState(null, '', href)
      } catch {
        window.location.href = href  // fallback to full reload
      }
    }
  }
}
</script>
```

**Key details:**
- `Alpine.initTree()` re-initializes any `x-data` components in the swapped content (EntryList, Dashboard, etc.)
- Sidebar active state uses `this.currentPath` instead of the server-rendered `activePath`
- External links (non-telescope URLs) fall through normally
- Only intercept links whose `href` starts with `basePath`

### What changes

- `Layout.ts` — add `telescopeApp()` component, `id="telescope-main"` on `<main>`, sidebar links get `@click.prevent`
- `EntryList.ts` — `goTo()` calls the parent `navigate()` instead of `window.location.href`
- `details/Layout.ts` — back links and batch links use `@click.prevent="navigate(href)"` via inline Alpine

---

## Phase 2 — Request Detail Improvements (~1.5h)

### 2a. Capture more metadata in RequestCollector

**`collectors/request.ts`** — extend the stored content:

```ts
const entry = createEntry('request', {
  method, url, path, query, headers, body, duration, params,
  // NEW:
  status:      res.statusCode,             // response status code
  ip:          req.ip || req.headers['x-forwarded-for'],
  userAgent:   req.headers['user-agent'],
  hostname:    req.headers['host'],
  response: {
    status:  res.statusCode,
    headers: redactHeaders(res.getHeaders(), hideHeaders),
    body:    responseBody,  // captured via res.on('finish')
  },
}, { batchId, tags })
```

Need to capture the response — wrap `res.send()` / intercept the response body. The Hono adapter may need a small extension to expose `res.statusCode` after `next()`.

Check what's available after `await next()` on the `res` object.

### 2b. Tabbed sections on detail pages

Add a reusable `Tabs` Alpine component in `sections.ts`:

```ts
export function Tabs(tabs: { label: string; content: SafeString }[]): SafeString {
  return html`
    <div x-data="{ tab: '${tabs[0].label}' }" class="mb-4">
      <div class="flex border-b border-gray-200 mb-4">
        ${tabs.map(t => html`
          <button @click="tab = '${t.label}'"
            :class="tab === '${t.label}' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
            class="px-4 py-2 text-sm font-medium border-b-2 -mb-px">
            ${t.label}
          </button>
        `)}
      </div>
      ${tabs.map(t => html`
        <div x-show="tab === '${t.label}'">${t.content}</div>
      `)}
    </div>
  `
}
```

### 2c. Update RequestView to use tabs

```
Card: Method | Path | Status (colored) | Duration | IP | Hostname | User-Agent

Tabs: [Payload] [Headers]
  Payload → request body (JsonBlock)
  Headers → request headers (KeyValueTable)

Tabs: [Response] [Response Headers]
  Response → response body
  Response Headers → response headers (KeyValueTable)
```

### 2d. Inline related entries on request detail

When a request has a `batchId`, fetch related entries and render them inline below the request detail — same as the Batch page timeline but embedded.

**Server-side:** the detail route already has access to `storage`. After fetching the entry, if it has a `batchId`, also fetch `storage.list({ batchId })` and pass the related entries to the view.

**`details/views.ts`** — `RequestView` receives an optional `relatedEntries` array. If present, render a "Related" section with the batch timeline (reuse `entrySummary()` from `Batch.ts`).

This is the **single highest-impact improvement** — seeing all queries, cache ops, events, and HTTP calls from one request on the same page.

### 2e. Formatted timestamps

Replace `"13s ago"` with `"April 12th 2026, 6:43 PM (13s ago)"` on detail pages. Keep the short `"13s ago"` format on list pages.

---

## Phase 3 — Polish (~1h)

### 3a. Status code coloring

Color the status code in the request detail card:
- 2xx → green
- 3xx → blue  
- 4xx → amber
- 5xx → red

### 3b. Toolbar in header

Add a slim toolbar bar to the Layout header (right side):
- **Pause/Resume** recording (calls `PATCH /api/recording` toggle)
- **Clear all** entries (calls `DELETE /api/entries`)
- **Refresh** current page

### 3c. Dashboard card labels

Fix dashboard card labels — instead of "requests" show "Requests" with proper casing. Link each card to its list page.

---

## Sequencing

1. **Phase 1** (SPA nav) — one commit. Can ship independently, immediately improves feel.
2. **Phase 2a** (request metadata) — collector change, needs testing.
3. **Phase 2b+2c** (tabs + request view redesign) — view changes only.
4. **Phase 2d** (inline related entries) — route + view change.
5. **Phase 2e** (timestamps) — small view helper.
6. **Phase 3** (polish) — independent items, ship as time allows.

---

## Files touched

| File | Changes |
|------|---------|
| `views/vanilla/Layout.ts` | SPA component, `id="telescope-main"`, sidebar `@click.prevent` |
| `views/vanilla/EntryList.ts` | `goTo()` uses SPA navigate |
| `views/vanilla/details/Layout.ts` | Links use SPA navigate |
| `views/vanilla/details/sections.ts` | New `Tabs()` component |
| `views/vanilla/details/views.ts` | RequestView tabs + related entries |
| `collectors/request.ts` | Capture status, ip, userAgent, hostname, response |
| `routes.ts` | Detail route fetches related entries for request type |

---

## Not in scope

- Dark mode — nice to have but not a parity gap
- Session tab — needs session package integration, separate effort  
- Views/template tracking — framework-specific, not a parity item
- Duplicate query detection — backend analysis, separate effort

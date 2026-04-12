# @rudderjs/view

Controller-view layer — Laravel's `view('id', props)` pattern rendered through Vike's SSR pipeline.

## Key Files

- `src/index.ts` — `view()`, `ViewResponse`, `html` tagged template, `escapeHtml()`, `SafeString`, `isViewResponse()`

## Architecture Rules

- **view() factory**: returns `ViewResponse` which `@rudderjs/server-hono` detects via duck-typing (`__rudder_view__` marker)
- **ID → URL mapping**: `view('dashboard')` → `/dashboard`, `view('admin.users')` → `/admin/users`
- **Route override**: export `const route = '/login'` in view file when URL diverges from id-derived path
- **Scanner**: `@rudderjs/vite` scans `app/Views/` and generates Vike pages at `/__view/<id>`
- **Multi-framework**: auto-detects vike-react/vue/solid; vanilla mode uses `html` tagged template
- **SPA nav**: full client-side navigation between controller views via `pageContext.json` fetches

## Conventions

- View files live in `app/Views/**` — e.g., `app/Views/Dashboard.tsx`, `app/Views/Auth/Login.tsx`
- Packages shipping views use `views/<framework>/` + `registerXRoutes()` pattern (see `@rudderjs/auth`)
- Only one renderer installed at a time (vike-react OR vike-vue OR vike-solid)

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- Missing `export const route = '/'` on Welcome page causes SPA nav fallback to full reloads
- The scanner depends on `@rudderjs/vite` — this package alone doesn't discover views

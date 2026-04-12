# @pilotiq/pilotiq — Panels on View Architecture

> **Status**: NOT STARTED
> **Repo**: pilotiq (new package `packages/pilotiq`)
> **Depends on**: `@rudderjs/view`, `@pilotiq/panels` (source clone), `@pilotiq/lexical`
> **Framework**: React-only for v1
> **Coexistence**: `@pilotiq/panels` stays untouched — both packages can coexist

## Overview

Clone `@pilotiq/panels` into a new `@pilotiq/pilotiq` package and refactor the rendering layer from the custom SSR metadata pipeline to `@rudderjs/view`. The admin panel becomes a set of Views rendered via Vike's SSR pipeline — no separate metadata resolution, no `/_meta` endpoint, no `SchemaElementRenderer` dispatch.

### Current Flow (panels)
```
Panel.schema() → resolveSchema() → JSON metadata → /_meta endpoint → client fetch → SchemaElementRenderer → React
```

### New Flow (pilotiq)
```
Controller → view('admin.resources.edit', { resource, record }) → Vike SSR → React component directly
```

---

## What Stays (clone as-is)

These are the valuable parts — the schema API, field system, and business logic:

- **Schema classes**: `Field.ts`, all field types (`TextField`, `SelectField`, `RichText`, etc.), `Form.ts`, `Table.ts`, `Section.ts`, `Tabs.ts`
- **Field API**: `.ai()`, `.aiSuggestions()`, `.persist()`, `.label()`, `.required()`, all builder methods
- **Resource / Panel / Page / Global**: builder classes and their APIs
- **Registries**: `ComponentRegistry`, `ClientToolRegistry`, `FormRegistry`, `ResolverRegistry`
- **Handlers**: CRUD resource handlers (list, show, store, update, delete)
- **AI actions**: `ai-actions/`, agents, `AiUiRegistry`
- **Theme system**: `theme/resolve.ts`, `generate-css.ts`, presets
- **i18n**: localization system
- **Types**: all type definitions

## What Changes (refactor)

### Phase 1: Package Setup + Admin Shell as View Layout

**1.1 Clone and rename**

```bash
cp -r packages/panels packages/pilotiq
# Rename package.json: @pilotiq/panels → @pilotiq/pilotiq
# Update internal imports
```

**1.2 Admin Layout View**

Replace the Vike page shell with a View-based layout:

```ts
// packages/pilotiq/views/react/AdminLayout.tsx
export const route = '/admin'

export default function AdminLayout({ panel, children }: AdminLayoutProps) {
  return (
    <div className="flex h-screen">
      <Sidebar panel={panel} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
```

**1.3 Register admin routes via controller**

```ts
// registerPilotiqRoutes(router, panel)
export function registerPilotiqRoutes(router: Router, panel: Panel) {
  router.get('/admin', [AdminController, 'dashboard'])
  router.get('/admin/resources/:resource', [ResourceController, 'index'])
  router.get('/admin/resources/:resource/create', [ResourceController, 'create'])
  router.get('/admin/resources/:resource/:id/edit', [ResourceController, 'edit'])
  // ...
}
```

Pattern follows `@rudderjs/auth`'s `registerAuthRoutes()`.

### Phase 2: Resource Pages as Views

**2.1 Remove the metadata pipeline**

Delete or bypass:
- `resolveSchema.ts` — the recursive SSR resolution engine
- `handlers/meta/` — `/_meta`, `/_badges`, `/_tables`, `/_stats` endpoints
- `pages/@panel/+data.ts` — SSR loader that calls resolveSchema
- `pages/_components/SchemaElementRenderer.tsx` — metadata → component dispatch

**2.2 Resource views receive props directly**

```ts
// ResourceController
class ResourceController {
  index(resource: Resource) {
    const records = await resource.query().paginate()
    return view('admin.resources.index', { resource, records })
  }

  edit(resource: Resource, id: string) {
    const record = await resource.query().find(id)
    return view('admin.resources.edit', { resource, record })
  }

  create(resource: Resource) {
    return view('admin.resources.create', { resource })
  }
}
```

**2.3 View components render fields directly**

```tsx
// views/react/Resources/Edit.tsx
export default function ResourceEdit({ resource, record }: Props) {
  const fields = resource.getFields()

  return (
    <AdminLayout>
      <Form resource={resource} record={record}>
        {fields.map(field => (
          <FieldRenderer key={field.name} field={field} value={record[field.name]} />
        ))}
      </Form>
    </AdminLayout>
  )
}
```

No metadata serialization — `FieldRenderer` reads the field class directly. Field components are still registered via `ComponentRegistry`, but looked up at render time, not from serialized metadata.

**2.4 Resource list/table view**

```tsx
// views/react/Resources/Index.tsx
export default function ResourceIndex({ resource, records }: Props) {
  return (
    <AdminLayout>
      <DataTable
        resource={resource}
        records={records}
        columns={resource.getTableColumns()}
      />
    </AdminLayout>
  )
}
```

### Phase 3: Live Preview

**3.1 Resource-level config**

```ts
Resource.make('Article')
  .fields([...])
  .livePreview({
    view: 'articles.show',
    props: (formData) => ({ article: formData }),
  })
```

**3.2 Split view on edit page**

When `livePreview` is configured, the edit page renders a split layout:

```tsx
// views/react/Resources/Edit.tsx
export default function ResourceEdit({ resource, record }: Props) {
  const [formData, setFormData] = useState(record)
  const preview = resource.getLivePreview()

  return (
    <AdminLayout>
      <div className="flex gap-4">
        <div className={preview ? 'w-1/2' : 'w-full'}>
          <Form resource={resource} record={record} onChange={setFormData}>
            {/* fields */}
          </Form>
        </div>
        {preview && (
          <div className="w-1/2 border rounded-lg overflow-hidden">
            <LivePreview
              view={preview.view}
              props={preview.props(formData)}
            />
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
```

**3.3 LivePreview component**

Two rendering modes:

```tsx
function LivePreview({ view, props, component }: LivePreviewProps) {
  if (component) {
    // Inline: render the component directly with props
    return <component {...props} />
  }

  // Iframe: load the actual view route, communicate via postMessage
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'pilotiq:preview-update', props },
      '*'
    )
  }, [props])

  return <iframe ref={iframeRef} src={viewUrl(view, props)} className="w-full h-full" />
}
```

**3.4 Frontend hook for iframe mode**

```ts
// @pilotiq/pilotiq/react
export function useLivePreview<T>(initialData: T): T {
  const [data, setData] = useState(initialData)

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'pilotiq:preview-update') {
        setData(event.data.props)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return data
}

// In the frontend view:
export default function ArticleShow({ article }: Props) {
  const data = useLivePreview(article)
  return <article><h1>{data.title}</h1>...</article>
}
```

### Phase 4: SPA Navigation + Polish

**4.1 Admin ↔ Frontend SPA nav**

Since both admin and frontend are Views, Vike handles SPA navigation between them. Clicking "View on site" from the admin doesn't full-reload — it's a client-side navigation.

**4.2 Breadcrumbs + navigation**

Admin navigation reads from `Panel` config (resources, pages, globals) and renders directly — no `/_meta` fetch needed.

**4.3 Theme injection**

`generateThemeCSS()` already works standalone. Inject it into the admin layout View:

```tsx
<style dangerouslySetInnerHTML={{ __html: generateThemeCSS(panel.getTheme()) }} />
```

---

## File Changes Summary

### New files
| File | Purpose |
|---|---|
| `packages/pilotiq/package.json` | New package |
| `packages/pilotiq/views/react/AdminLayout.tsx` | Admin shell layout |
| `packages/pilotiq/views/react/Dashboard.tsx` | Dashboard view |
| `packages/pilotiq/views/react/Resources/Index.tsx` | Resource list |
| `packages/pilotiq/views/react/Resources/Create.tsx` | Resource create form |
| `packages/pilotiq/views/react/Resources/Edit.tsx` | Resource edit form + live preview |
| `packages/pilotiq/views/react/Resources/Show.tsx` | Resource detail |
| `packages/pilotiq/src/controllers/AdminController.ts` | Dashboard controller |
| `packages/pilotiq/src/controllers/ResourceController.ts` | Resource CRUD controllers |
| `packages/pilotiq/src/routes.ts` | `registerPilotiqRoutes()` |
| `packages/pilotiq/src/components/LivePreview.tsx` | Preview component (iframe + inline) |
| `packages/pilotiq/src/components/FieldRenderer.tsx` | Direct field → component rendering |
| `packages/pilotiq/src/hooks/useLivePreview.ts` | Frontend preview hook |

### Removed from clone
| File | Reason |
|---|---|
| `src/resolveSchema.ts` | Replaced by direct View rendering |
| `handlers/meta/*` | No metadata endpoints needed |
| `pages/@panel/+data.ts` | No SSR metadata loader |
| `pages/_components/SchemaElementRenderer.tsx` | No metadata dispatch |

### Kept from clone
| Directory | Reason |
|---|---|
| `src/schema/` | All field/element classes — the API stays identical |
| `src/registries/` | Component + tool registries |
| `src/handlers/resource/` | CRUD handlers (may simplify) |
| `src/ai-actions/` | AI integration |
| `src/theme/` | Theme system |
| `src/i18n/` | Localization |

---

## Migration Path for Existing Apps

Apps using `@pilotiq/panels` can migrate incrementally:

```ts
// Before (panels)
import { Panel, Resource } from '@pilotiq/panels'

// After (pilotiq)
import { Panel, Resource } from '@pilotiq/pilotiq'
// + add registerPilotiqRoutes() in routes/web.ts
// + add views to app/Views/Admin/ (or use package defaults)
```

The schema API is identical — only the import path and route registration change.

---

## Open Questions

1. **CRUD handlers**: Do resource handlers stay as API routes, or do they become controller actions too? (API routes are simpler for client-side mutations like save/delete)
2. **Async data in schema elements**: `View.make().data(async fn)` currently resolves server-side in resolveSchema. In the new model, does this become a React Server Component pattern, or client-side fetching?
3. **Plugin resolvers**: Third-party schema element types currently register via `ResolverRegistry`. How do they plug in without resolveSchema?

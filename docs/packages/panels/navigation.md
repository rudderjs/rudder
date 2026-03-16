# Navigation

Customize how resources and pages appear in the panel sidebar or topbar navigation.

---

## Navigation Groups

Group related resources under collapsible sidebar sections using `static navigationGroup`:

```ts
export class ArticleResource extends Resource {
  static navigationGroup = 'Content'
  // ...
}

export class CategoryResource extends Resource {
  static navigationGroup = 'Content'
  // ...
}

export class UserResource extends Resource {
  static navigationGroup = 'Admin'
  // ...
}
```

Resources with the same `navigationGroup` value appear under a shared collapsible section in the sidebar. Resources without a `navigationGroup` appear at the top level.

---

## Navigation Badges

Display a dynamic badge next to a resource's navigation link -- useful for showing record counts, pending items, or status indicators:

```ts
export class ArticleResource extends Resource {
  static navigationBadge = async () => await Article.query().count()
  static navigationBadgeColor = 'primary' // 'gray' | 'primary' | 'success' | 'warning' | 'danger'
  // ...
}
```

Badge values are resolved server-side via the `GET /{panel}/api/_badges` endpoint. The panel fetches badge values when the sidebar renders and updates them periodically.

### Badge Colors

| Color | Use case |
|---|---|
| `'gray'` | Neutral count (default) |
| `'primary'` | General highlight |
| `'success'` | Positive status |
| `'warning'` | Needs attention |
| `'danger'` | Critical / overdue |

---

## Guard

Restrict access to an entire panel using `.guard()`:

```ts
Panel.make('admin').guard(async (ctx) => {
  return ctx.user?.role === 'admin'
})
```

`ctx`:

| Property | Type | Description |
|---|---|---|
| `user` | `PanelUser \| undefined` | Authenticated user (from `req.user`) |
| `headers` | `Record<string, string>` | Request headers |
| `path` | `string` | Request path |

Returning `false` redirects unauthenticated users to `/login?redirect=<encodedPath>` for UI requests, and responds with `401 Unauthorized` for API requests.

**Accessing custom user fields** -- if your guard references a custom field like `ctx.user?.role`, you must declare it in `user.additionalFields` in `config/auth.ts`. Without this declaration the field is `undefined` even if it exists in the database:

```ts
// config/auth.ts
export default {
  // ...
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
} satisfies BetterAuthConfig
```

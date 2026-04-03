# API Routes

`@rudderjs/panels` auto-generates a full CRUD API for each registered resource. All routes are mounted under the panel's path prefix.

---

## Auto-generated Routes

For each resource, the following routes are mounted at boot:

| Method | Path | Description |
|---|---|---|
| `GET` | `/{panel}/api/_meta` | Panel structure -- resources, fields, filters, actions, layout |
| `GET` | `/{panel}/api/_search` | Global search across all resources -- `?q=query&limit=5` (max 20) |
| `GET` | `/{panel}/api/_badges` | Navigation badge values for all resources |
| `GET` | `/{panel}/api/{resource}` | List -- paginated, searchable, sortable, filterable |
| `GET` | `/{panel}/api/{resource}/:id` | Show one record |
| `POST` | `/{panel}/api/{resource}` | Create |
| `PUT` | `/{panel}/api/{resource}/:id` | Update |
| `DELETE` | `/{panel}/api/{resource}/:id` | Delete one record |
| `DELETE` | `/{panel}/api/{resource}` | Bulk delete -- body: `{ ids: string[] }` |
| `POST` | `/{panel}/api/{resource}/_action/:name` | Run bulk action |
| `POST` | `/{panel}/api/_upload` | File upload (used by FileField) |
| `GET` | `/{panel}/api/{resource}/_options` | Relation select options -- used by RelationField |
| `GET` | `/{panel}/api/{resource}/_schema` | Field definitions -- used for inline create dialog |
| `GET` | `/{panel}/api/{resource}/_related` | HasMany records -- `?fk=col&id=val[&through=true]` |
| `POST` | `/{panel}/api/{resource}/:id/_restore` | Restore soft-deleted record |
| `DELETE` | `/{panel}/api/{resource}/:id/_force` | Permanently delete |
| `POST` | `/{panel}/api/{resource}/_restore` | Bulk restore -- body: `{ ids: string[] }` |
| `DELETE` | `/{panel}/api/{resource}/_force` | Bulk force delete -- body: `{ ids: string[] }` |
| `GET` | `/{panel}/api/{resource}/:id/_versions` | List version snapshots |
| `POST` | `/{panel}/api/{resource}/:id/_versions` | Create version snapshot |
| `GET` | `/{panel}/api/{resource}/:id/_versions/:vid` | Version detail |
| `GET` | `/{panel}/api/_globals/{slug}` | Read global settings |
| `PUT` | `/{panel}/api/_globals/{slug}` | Update global settings |

---

## List Query Parameters

| Param | Example | Description |
|---|---|---|
| `page` | `?page=2` | Page number (default: 1) |
| `perPage` | `?perPage=25` | Records per page (default: `static perPage`, max: 100) |
| `search` | `?search=alice` | Search across `.searchable()` fields |
| `sort` | `?sort=name` | Sort column (must be `.sortable()`) |
| `dir` | `?dir=DESC` | Sort direction -- `ASC` or `DESC` (default: `ASC`) |
| `filter[field]` | `?filter[role]=admin` | Apply a registered filter |
| `tab` | `?tab=published` | Apply a tab filter |
| `trashed` | `?trashed=true` | Show soft-deleted records (when `softDeletes` enabled) |

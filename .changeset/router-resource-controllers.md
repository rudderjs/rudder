---
'@rudderjs/router': minor
'@rudderjs/cli': patch
---

Add Laravel-style `Route::resource` / `apiResource` / `singleton` to `@rudderjs/router` and `make:controller --resource`/`--api`/`--singleton` flags to `@rudderjs/cli` (Laravel parity #5, PR3 of 3).

**Public API on `Router`:**

- `router.resource(name, Ctrl, opts?)` — registers the seven canonical RESTful routes (`index`/`create`/`store`/`show`/`edit`/`update`/`destroy`). The `update` route is registered for both `PUT` and `PATCH` at the same path.
- `router.apiResource(name, Ctrl, opts?)` — same as `resource` but skips `create` + `edit` (no HTML form pages).
- `router.singleton(name, Ctrl, opts?)` — registers `show`/`edit`/`update` only. The returned `SingletonRegistration` exposes `.creatable()` (adds `GET /<name>/create` + `POST /<name>`) and `.destroyable()` (adds `DELETE /<name>`).

```ts
class PostController {
  async index   (ctx) { /* … */ }
  async show    (ctx) { /* … */ }
  async store   (ctx) { /* … */ }
  // …
}

router.resource('posts', PostController)
router.apiResource('posts', PostController, { only: ['index', 'show'] })
router.singleton('profile', ProfileController).creatable().destroyable()
```

**Controller convention:** plain class, no decorators. Methods are matched by name to the canonical verbs. **Methods the controller doesn't implement are silently skipped** — a controller with only `index`/`show` works without an `only` or `except` filter.

**`ResourceOptions`:** `only`, `except`, `parameters` (override `:param` segment name), `names` (override generated route names), `middleware`.

**Default route names:** `<resource>.<verb>` (e.g. `posts.index`, `posts.show`). Default `:param` name is a naive singular of `name` (`posts → post`, `categories → category`, `boxes → box`); irregular plurals must use the `parameters` option.

**Per-route customisation:** the returned `ResourceRegistration` exposes the underlying `RouteBuilder[]` in declaration order. Apply `where*()` or per-route middleware to a single verb without affecting the rest:

```ts
const reg = router.resource('posts', PostController)
reg.builders[3].whereNumber('post')   // constrain show route only
```

**Scaffolder support:** `make:controller` accepts three mutually-exclusive flags:

```bash
pnpm rudder make:controller PostController --resource     # full 7-verb plain class
pnpm rudder make:controller PostController --api          # 5-verb (no create/edit)
pnpm rudder make:controller ProfileController --singleton # show/edit/update only
```

Default `make:controller` (no flag) still emits the decorator-based stub.

This completes the router parity sweep (#5). PR1 added `where*()` constraints; PR2 added `router.group()` / subdomain routing / `.missing()`. No changes to the public surface of any other package.

**Internal note:** `MakeSpec.stub` callback now receives the parsed CLI opts as a second argument (`(className, opts) => string`), enabling per-flag stub dispatch. Existing single-arg callbacks continue to type-check.

# Tinker

`pnpm rudder tinker` boots your app and drops you into a Node REPL with the DI container, route helpers, and every model in `app/Models/` pre-imported. It's RudderJS's equivalent of `php artisan tinker` — the interactive shell you reach for when you need to probe the database, dispatch a job, or test a service without writing a one-off script.

```bash
$ pnpm rudder tinker

  RudderJS Tinker — node v22.14.0, env=local

  Available:
    Comment, Post, Route, Rudder, Tag, Todo, Url, User, Video, app, config
    route, rudder

  Top-level await is enabled. Type .help for commands.

> await User.count()
12

> const alice = await User.where('email', 'alice@example.com').first()
> alice.name
'Alice'

> alice.posts().count()
5

> Route.get('/health').name('health')

> route('users.show', { id: alice.id })
'/users/42'
```

Top-level `await` is supported. Press **Ctrl-D** or type `.exit` to quit.

## What's in the context

Every model class under `app/Models/` is registered by its export name. Default exports are keyed by the filename:

```ts
// app/Models/User.ts
export class User extends Model { /* ... */ }
// → available as `User`

// app/Models/Post.ts
export default class Post extends Model { /* ... */ }
// → available as `Post` (filename stem)
```

Framework facades are added when their providers are loaded:

| Name | What |
|---|---|
| `app` | DI container accessor — `app().make('cache')`, `app().bound('queue')` |
| `config` | Typed config reader — `config('database')`, `config('mail.from.address')` |
| `Route` | The global router — register routes ad-hoc and inspect existing ones |
| `route` | URL generator — `route('users.show', { id: 1 })` |
| `Url` | Signed-URL helper |
| `rudder` / `Rudder` | The command registry |

A broken model file (syntax error, missing import) emits one warning and doesn't take down the REPL — the rest of your models stay usable.

## Meta-commands

In addition to Node's built-in REPL commands (`.help`, `.editor`, `.save`, `.load`, `.clear`, `.exit`), tinker adds:

| Command | Effect |
|---|---|
| `.boot` | Re-run the app boot to pick up code/schema changes. **Heads up:** user-held references (e.g. `const u = ...`) still point at the old instances; assign again from the fresh registry to get the new behavior. |

History persists to `~/.rudder-tinker-history`. Use `--no-history` to opt out (useful for ephemeral sandboxes), `--no-banner` to suppress the welcome block (useful when piping or scripting).

## How it differs from `node --experimental-repl-await`

Running plain `node` from your project gives you a REPL but no app context — no DI container, no models, no route registry. Tinker boots the framework exactly like `pnpm dev` does (without starting any network listeners), so the queries you run hit the same DI graph the live server would.

The cli sets `RUDDERJS_TINKER=1` before boot. Most providers don't check it — Prisma + BullMQ + ORM clients are lazy-construct, and network listeners only start from `app.listen()` / `app.serve()` which tinker never calls. The env var is the escape hatch for providers that DO actively poll or open connections on `boot()` (`@rudderjs/horizon`'s `WorkerCollector` is the canonical case — same pattern as `RUDDERJS_QUEUE_WORKER=1` set by `queue:work`).

## Pitfalls

- **`.boot` doesn't tear down provider connections.** A `.boot` after a code change refreshes the context bindings but doesn't dispose the previous provider instances. If you held a reference to a fixture you created (`const user = await User.create(...)`), it still points at the old instance. For a clean slate, exit and re-launch tinker.
- **Top-level `await` only works at the REPL prompt, not inside `.editor`.** Inside `.editor`, you're authoring a script body — wrap async work in an `async () => { ... }` IIFE if you need top-level await behavior.
- **Models with side-effects-on-import (DB connections, event subscriptions) fire at tinker startup.** Same as in production — if your model file calls something at module-init time, tinker will trigger it during the model walk.
- **Production safety.** Tinker is a dev tool. It boots whatever app you're in — if you accidentally run it against a production `.env`, you have direct database access. There's no read-only mode. Treat it like `psql` against prod.

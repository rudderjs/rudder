---
"@rudderjs/cli": minor
---

Add four missing `make:*` generators — `make:policy`, `make:observer`, `make:cast`, `make:notification`.

Each scaffolds against a real framework base class:

- **`make:policy`** → `app/Policies/<Name>Policy.ts`, `extends Policy` (`@rudderjs/auth`) with ability methods.
- **`make:observer`** → `app/Observers/<Name>Observer.ts`, `implements ModelObserver` (`@rudderjs/orm`) with lifecycle hooks (`Model.observe(...)`).
- **`make:cast`** → `app/Casts/<Name>.ts` (no suffix, Laravel parity), `implements CastUsing` (`@rudderjs/orm`) with the sync `get`/`set` pair.
- **`make:notification`** → `app/Notifications/<Name>Notification.ts`, `extends Notification` (`@rudderjs/notification`) with `via()` + a `toDatabase()` builder.

All four support `--with-test` (unit). `make:rule` and `make:scope` were deliberately **not** shipped: Rudder validation is zod-based via `FormRequest` (no first-class `Rule` type) and global scopes are inline `ScopeFn` functions in `static globalScopes` (no standalone `Scope` class) — neither has an abstraction to scaffold against.

---
'create-rudder-app': patch
---

Fix scaffolded auth flow — registration was failing with two latent bugs:

- `prisma/schema/auth.prisma` used a better-auth-style schema (password on `Account`) while `routes/api.ts` and `app/Models/User.ts` expected `password` directly on `User`. The User model now matches the playground (User with `password`, `rememberToken` + `PasswordResetToken`), dropping the unused `Session`/`Account`/`Verification` models.
- `config/auth.ts` emitted `providers.users.model: 'User'` as a string. `EloquentUserProvider.retrieveById` calls `this.model.find(id)` and needs the actual class. Now imports and passes the `User` class.

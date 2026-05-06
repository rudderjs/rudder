---
'@rudderjs/auth': minor
'@rudderjs/sanctum': patch
---

Stop leaking sensitive user columns into `req.user` (T5).

- `userToPlain(user)` is now exported from `@rudderjs/auth`. Always strips functions plus `password`, `rememberToken`, and `remember_token` (the last two cover both Prisma camelCase and Drizzle/raw-Laravel snake_case schema choices). The previous filter only removed functions and `password`, so columns like `remember_token`, `two_factor_secret`, and `email_verification_token` could surface in `req.user`.
- `Authenticatable.getHidden?(): string[]` is a new optional method on the contract — Laravel's `$hidden` array. User models that implement it can name app-specific sensitive columns (`two_factor_secret`, `email_verification_token`, …) and `userToPlain` will strip them on top of the always-hidden defaults.
- `@rudderjs/sanctum`'s middleware now delegates to the shared `userToPlain` instead of inlining a near-duplicate filter loop, so sanctum-authenticated requests inherit the same protection.
- Fixed a pre-existing bug in `userToPlain` where the spread of the original record was placed _after_ the explicit `String(...)` conversions for `id` / `name` / `email`, silently overriding them. The conversions now win on collision so `id`, `name`, and `email` are guaranteed strings as the `AuthUser` type promises.

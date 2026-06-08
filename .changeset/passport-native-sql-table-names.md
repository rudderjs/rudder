---
"@rudderjs/passport": major
---

Run the OAuth models on the native engine, and on both engines from one model set.

The 5 models (`OAuthClient`, `AccessToken`, `RefreshToken`, `AuthCode`, `DeviceCode`) now carry the real SQL table names (`oauth_clients`, `oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_auth_codes`, `oauth_device_codes`) in `static table` instead of the Prisma camelCase delegate names, and set `static keyType = 'ulid'` so the ORM stamps a primary key on insert. The native engine has no `@default(cuid())`, so without this the row id (which `AccessToken` uses as the JWT subject) would insert NULL — breaking token issuance on a native-engine deployment.

**Breaking — Prisma apps must upgrade `@rudderjs/orm-prisma`** to a release with the SQL-table-name → delegate fallback. Without it, queries fail with `Prisma has no delegate for table "oauth_clients"`. With it, the SQL name resolves to the `oAuthClient` delegate via the client's runtime datamodel — no schema or data change needed.

**Behavior change — new primary keys are ulid, not cuid.** Existing cuid rows are untouched (both are opaque strings in a `String @id` column); only rows created after upgrading get ulid ids. Access tokens / auth codes / device codes are short-lived, so the mix drains quickly. No migration required.

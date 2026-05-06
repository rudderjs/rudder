---
'@rudderjs/passport': patch
---

`passport:client` CLI flag fixes — closes finding L2 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

**`--personal` is now a hint, not a client.** The previous behavior created an OAuth client with `grantTypes: ['personal_access']`, but `personal_access` is not an HTTP grant — `/oauth/token` rejects it, and personal access tokens go through `HasApiTokens.createToken()` against an internal `__personal_access__` client that the framework auto-manages. The CLI row was an orphan, present in the DB but unreachable through any flow. `passport:client --personal` now prints a short hint pointing at `HasApiTokens.createToken()` and exits without writing to the database. Pure CLI ergonomics — no migration needed.

**`--device` clients now also carry `refresh_token`.** Device clients used to ship with only `urn:ietf:params:oauth:grant-type:device_code` in their grants array. Once the device flow exchanged a user_code for a token pair, the bundled refresh token was unusable: `/oauth/token` rejects refresh requests for clients whose grantTypes don't list `refresh_token`. RFC 8628 doesn't mandate a fixed list; pairing `refresh_token` with the device flow is the expected default for any device client that wants long-lived sessions on the polled device. New `--device` invocations get both grants.

The grant-type → flag mapping is extracted to a new exported helper, `resolveClientGrantTypes({ isDevice, isM2M })`, so the CLI handler stays a thin wrapper and the mapping is unit-testable without booting the full provider.

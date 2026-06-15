---
"@rudderjs/storage": patch
---

Harden the S3 adapter (credentials, visibility, upload URLs).

- **Don't build a broken client from partial credentials.** `getClient` attached explicit `credentials` whenever `accessKeyId` was truthy, defaulting the secret to `''`. A half-configured pair (access key set, secret unset — the default scaffold reads `Env.get('AWS_SECRET_ACCESS_KEY','')`) built a client signing with an empty secret AND suppressed the AWS default credential chain (env / instance role / SSO). Credentials are now attached only when both parts are non-empty, otherwise the SDK's default chain applies.
- **`getVisibility` no longer under-reports public exposure.** It only matched `AllUsers` + `READ`; an object granting `READ` to `AuthenticatedUsers` (any authenticated AWS principal, in any account) or `FULL_CONTROL` to `AllUsers` was reported `private`. It now treats either group with `READ` or `FULL_CONTROL` as public.
- **`temporaryUploadUrl` can constrain the upload.** It presigned a bare PUT (any content-type, overwrite). It now accepts a `TemporaryUploadUrlOptions` with `contentType`, which is bound into the signature (the client must send a matching `Content-Type`, returned in `headers`) so an upload URL can't be used to store arbitrary executable content the app later serves inline.

---
"@rudderjs/contracts": patch
---

Make `AppRequest.input()` type-honest. The no-fallback form is now typed `T | undefined` instead of `T`, since a missing key returns `undefined` at runtime. Implemented as an overload, so the with-fallback form still returns a guaranteed `T`, and untyped calls keep returning `unknown` (the default `T = unknown` makes `T | undefined` collapse to `unknown`). Runtime behavior is unchanged; this only corrects a previously unsound return type that hid possible-undefined access behind an explicit type argument.

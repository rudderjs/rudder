---
"@rudderjs/support": patch
---

Fix `resolveOptionalPeer()` for ESM-only packages imported by subpath (e.g. `@rudderjs/ai/server`).

When `createRequire().resolve()` rejected a subpath import because the package's exports field defined only an `import` condition (no `require` / `default`), the ESM-aware fallback then tried to `findPackageJson` using the full `<pkg>/<subpath>` string as the package name. That path never resolves to a real `package.json`, so the fallback also failed and the caller saw "Cannot find package … from <cwd>" — even though the package was correctly installed.

The fallback now splits the specifier into a bare package name + a subpath, walks `node_modules` for the package, and resolves the requested subpath against its `exports` map. The visible symptom in apps scaffolded by `create-rudder-app` with `@rudderjs/ai` selected was a misleading `[RudderJS] @rudderjs/ai listed in the provider manifest but not installed` warning and a silently missing `AiProvider`.

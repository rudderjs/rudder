# @rudderjs/vite

## 0.0.4

### Patch Changes

- Add database driver packages (`pg`, `mysql2`, `better-sqlite3`, `@prisma/adapter-*`, `@libsql/client`) to SSR externals so they are never bundled into the client build.

## 0.0.3

### Patch Changes

- Suppress "Sourcemap points to missing source files" warnings for @rudderjs/\* packages in dev server output

## 0.0.2

### Patch Changes

- Fix `virtual:` ESM URL scheme error when scaffolded app serves pages

  Add `@rudderjs/server-hono` to `ssr.noExternal` so Vite processes it through its module runner rather than loading it natively. When loaded natively, its dynamic `import('@photonjs/hono')` also loads `@photonjs/hono` natively, which causes static imports of `virtual:photon:get-middlewares:*` virtual modules to fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. This fix ensures the virtual import is handled by Vite's plugin system.

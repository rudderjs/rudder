# @boostkit/vite

## 0.0.2

### Patch Changes

- Fix `virtual:` ESM URL scheme error when scaffolded app serves pages

  Add `@boostkit/server-hono` to `ssr.noExternal` so Vite processes it through its module runner rather than loading it natively. When loaded natively, its dynamic `import('@photonjs/hono')` also loads `@photonjs/hono` natively, which causes static imports of `virtual:photon:get-middlewares:*` virtual modules to fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. This fix ensures the virtual import is handled by Vite's plugin system.

---
'create-rudder-app': patch
---

Scaffolded `pages/**/+config.ts` for vue/solid now emit plain `} satisfies Config` instead of the `as unknown as Config` workaround. The underlying upstream issue (vikejs/vike#3251) is fixed in vike core — vike-react 0.6.23, vike-vue 0.9.11, and vike-solid 0.8.2 all typecheck cleanly under `exactOptionalPropertyTypes: true` against plain `satisfies Config`.

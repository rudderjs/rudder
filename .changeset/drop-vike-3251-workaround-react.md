---
'create-rudder-app': patch
---

Drop the `} as unknown as Config` workaround for vikejs/vike#3251 from the React `+config.ts` templates. The bug was fixed upstream in `vike-react@0.6.23` — generated React projects now use the cleaner `} satisfies Config`. The minimum pinned `vike-react` bumps from `^0.6.20` to `^0.6.23` in the scaffolder's `package.json` template.

Vue and Solid templates still emit `} as unknown as Config` because `vike-vue` and `vike-solid` haven't shipped an equivalent fix yet.

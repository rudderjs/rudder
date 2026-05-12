# @rudderjs/cashier-paddle

## 3.0.1

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

- Updated dependencies [d0db9f0]
- Updated dependencies [b74fc57]
- Updated dependencies [937cdac]
  - @rudderjs/auth@5.1.0
  - @rudderjs/orm@1.9.1
  - @rudderjs/view@1.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [e8cee45]
- Updated dependencies [942bd78]
- Updated dependencies [015e16e]
- Updated dependencies [231d7f6]
- Updated dependencies [015e16e]
  - @rudderjs/auth@5.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/orm@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/view@1.0.0
  - @rudderjs/auth@4.0.0

## 1.0.1

### Patch Changes

- 7bf4e46: Fix `cashier:install` command — `dist/commands/install.js` referenced `@rudderjs/rudder` (renamed to `@rudderjs/console` in v0.0.4) and tried to call a non-existent `runVendorPublish` export, breaking SSR builds and leaving the `cashier:install` command broken at runtime. The dead programmatic-fallback path is gone; the command now just prints the canonical install steps for the user to run.

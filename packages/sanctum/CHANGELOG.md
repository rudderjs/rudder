# @rudderjs/sanctum

## 6.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- Updated dependencies [4c8cd07]
  - @rudderjs/auth@4.0.3
  - @rudderjs/core@1.1.2

## 6.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/auth@4.0.0

## 5.0.1

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/auth@3.2.1

## 5.0.0

### Patch Changes

- Updated dependencies [5239815]
  - @rudderjs/auth@3.2.0

## 4.0.1

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/auth@3.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [e720923]
- Updated dependencies [d3d175c]
  - @rudderjs/core@0.1.1
  - @rudderjs/auth@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/core@0.1.0
  - @rudderjs/auth@3.0.0

## 2.0.1

### Patch Changes

- @rudderjs/auth@2.0.1
- @rudderjs/core@0.0.12

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/auth@2.0.0
  - @rudderjs/core@0.0.11

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/auth@1.0.0
  - @rudderjs/core@0.0.10

## 0.0.2

### Patch Changes

- Updated dependencies [e1189e9]
  - @rudderjs/auth@0.2.1
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9

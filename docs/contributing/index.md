# Contributing to RudderJS

Guides for working on the RudderJS monorepo — adding packages, extending the panels framework, and following project conventions.

## In this section

| Guide | Description |
|---|---|
| [Creating a New Package](./new-package) | Scaffold, conventions, testing, and publishing a new `@rudderjs/*` package |

## Quick orientation

- **Monorepo root**: `pnpm build` — builds all packages via Turbo
- **Single package**: `cd packages/<name> && pnpm build / pnpm test`
- **Playground** (demo app): `cd playground && pnpm dev`
- **Docs** (this site): `cd docs && pnpm dev`

See [`CLAUDE.md`](https://github.com/rudderjs/rudder/blob/main/CLAUDE.md) in the repo root for the full development reference including common pitfalls and architecture decisions.

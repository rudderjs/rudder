# Contributing to BoostKit

Guides for working on the BoostKit monorepo — adding packages, extending the panels framework, and following project conventions.

## In this section

| Guide | Description |
|---|---|
| [Creating a New Package](./new-package) | Scaffold, conventions, testing, and publishing a new `@boostkit/*` package |
| [Creating a Panels Extension](./panels-extension) | Build a package that extends `@boostkit/panels` with new field types or editor integrations |

## Quick orientation

- **Monorepo root**: `pnpm build` — builds all packages via Turbo
- **Single package**: `cd packages/<name> && pnpm build / pnpm test`
- **Playground** (demo app): `cd playground && pnpm dev`
- **Docs** (this site): `cd docs && pnpm dev`

See [`CLAUDE.md`](https://github.com/boostkitjs/boostkit/blob/main/CLAUDE.md) in the repo root for the full development reference including common pitfalls and architecture decisions.

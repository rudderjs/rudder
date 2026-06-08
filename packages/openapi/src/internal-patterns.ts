// Mirrors `ROUTE_PATTERN_NUMBER` in `@rudderjs/router`. Inlined (not imported)
// because router is an OPTIONAL peer — the emitter must parse paths even when
// the constant's source package isn't on the dependency graph at type-check
// time. Keep in sync with `packages/router/src/index.ts`.
export const ROUTE_PATTERN_NUMBER = '[0-9]+'

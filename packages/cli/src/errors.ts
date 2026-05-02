/**
 * Re-export of the canonical `CliError` from `@rudderjs/console`. Kept here so
 * existing `import { CliError } from '@rudderjs/cli'` paths still work; new code
 * should import from `@rudderjs/console` (where command primitives live).
 */
export { CliError } from '@rudderjs/console'

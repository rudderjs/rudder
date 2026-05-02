---
'@rudderjs/console': major
'@rudderjs/cli': patch
---

Graduate `@rudderjs/console` to 1.0.0.

The command registry (`Rudder` / `rudder`), `CommandBuilder` chain, `Command` abstract class (with argument/option accessors, output helpers `info`/`error`/`warn`/`line`/`comment`/`newLine`/`table`, and prompt helpers `ask`/`confirm`/`choice`/`secret`), `parseSignature()`, the `MakeSpec` scaffolder pipeline (`registerMakeSpecs`/`getMakeSpecs`/`executeMakeSpec`), and the `CommandObserverRegistry` are now stable.

`CliError` moves from `@rudderjs/cli` to `@rudderjs/console`. `@rudderjs/cli` keeps re-exporting it for backwards compatibility, so `import { CliError } from '@rudderjs/cli'` continues to work — but new code should import from `@rudderjs/console` (where the rest of the command primitives live).

Boost guidelines were corrected — prior versions documented prompt methods (`prompt`, `select`, `multiselect`, `success`) that don't exist on the `Command` class. The real names are `ask`, `choice`, `info`.

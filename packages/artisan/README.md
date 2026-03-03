# @boostkit/artisan

Command registry and command primitives for defining and running CLI commands.

## Installation

```bash
pnpm add @boostkit/artisan
```

## Usage

```ts
import { artisan, Command } from '@boostkit/artisan'

artisan.command('greet {name}', () => {
  console.log('Hello!')
}).description('Print a greeting')

class PingCommand extends Command {
  readonly signature = 'ping {--N|name=}'
  readonly description = 'Ping command'
  handle() { this.info(`pong ${String(this.option('name') ?? '')}`) }
}

artisan.register(PingCommand)
```

## API Reference

- `ConsoleHandler`
- `CommandBuilder`
- `ArtisanRegistry`
- `parseSignature(signature)`
- `CommandArgDef`, `CommandOptDef`, `ParsedSignature`
- `Command`
- `artisan` (global registry)

## Configuration

This package has no runtime config object.

## Notes

- `parseSignature()` supports required/optional args, variadics, options, defaults, and shorthand flags.
- `Command` includes output helpers (`info`, `error`, `warn`, `line`, `table`) and prompt helpers.

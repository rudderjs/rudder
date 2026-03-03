# @boostkit/di

Dependency injection container with decorators for constructor injection.

## Installation

```bash
pnpm add @boostkit/di
```

## Usage

```ts
import 'reflect-metadata'
import { Container, Injectable, Inject } from '@boostkit/di'

@Injectable()
class Logger {}

@Injectable()
class UserService {
  constructor(@Inject('app.name') readonly appName: string, readonly logger: Logger) {}
}

const c = new Container()
c.instance('app.name', 'BoostKit')
const service = c.make(UserService)
```

## API Reference

- `Injectable()` — marks a class for container auto-resolution.
- `Inject(token)` — overrides constructor parameter token.
- `Container` — DI container with `bind`, `singleton`, `instance`, `alias`, `make`, `has`, `forget`, `reset`.
- `container` — global container singleton.

## Configuration

This package has no runtime config object.

## Notes

- `reflect-metadata` is required for decorator metadata at runtime.
- Import `reflect-metadata` once in your app entrypoint before resolving decorated classes.

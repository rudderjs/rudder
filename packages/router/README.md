# @boostkit/router

Decorator-based and fluent HTTP router with mount support for server adapters.

## Installation

```bash
pnpm add @boostkit/router
```

## Usage

```ts
import { router, Controller, Get } from '@boostkit/router'

router.get('/health', () => new Response('ok'))

@Controller('/users')
class UserController {
  @Get('/:id')
  show() {
    return new Response('user')
  }
}

router.registerController(UserController)
```

## API Reference

- Decorators: `Controller`, `Middleware`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`
- `Router`
- `router` (global router singleton)

## Configuration

This package has no runtime config object.

## Notes

- Call `router.mount(serverAdapter)` to register middleware and routes on a server implementation.
- Uses metadata decorators; ensure `reflect-metadata` is loaded in apps using decorators.

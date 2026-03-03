# make: Commands

The `make:*` commands scaffold boilerplate files from templates. All commands support the `--force` flag to overwrite existing files.

## Usage

```bash
pnpm artisan make:<type> <Name> [--force]
```

## Commands Reference

### `make:controller`

Generates a controller class with decorator-based routing.

```bash
pnpm artisan make:controller UserController
# → app/Http/Controllers/UserController.ts
```

Generated file:

```ts
import { Controller, Get } from '@forge/router'
import type { ForgeRequest, ForgeResponse } from '@forge/contracts'

@Controller('/user-controller')
export class UserController {
  @Get('/')
  async index(_req: ForgeRequest, res: ForgeResponse) {
    return res.json({ message: 'ok' })
  }
}
```

### `make:model`

Generates an ORM model class.

```bash
pnpm artisan make:model Post
# → app/Models/Post.ts
```

Generated file:

```ts
import { Model } from '@forge/orm'

export class Post extends Model {
  static table = 'post'

  id!: string
}
```

### `make:job`

Generates a queue job class.

```bash
pnpm artisan make:job SendWelcomeEmail
# → app/Jobs/SendWelcomeEmailJob.ts
```

Generated file:

```ts
import { Job } from '@forge/queue'

export class SendWelcomeEmailJob extends Job {
  async handle(): Promise<void> {
    // implement job logic here
  }
}
```

### `make:middleware`

Generates a middleware class.

```bash
pnpm artisan make:middleware Auth
# → app/Http/Middleware/AuthMiddleware.ts
```

Generated file:

```ts
import { Middleware } from '@forge/middleware'
import type { ForgeRequest, ForgeResponse } from '@forge/contracts'

export class AuthMiddleware extends Middleware {
  async handle(
    _req: ForgeRequest,
    _res: ForgeResponse,
    next: () => Promise<void>
  ): Promise<void> {
    await next()
  }
}
```

### `make:request`

Generates a FormRequest class for input validation.

```bash
pnpm artisan make:request CreateUser
# → app/Http/Requests/CreateUserRequest.ts
```

Generated file:

```ts
import { FormRequest } from '@forge/validation'
import { z } from 'zod'

export class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      // define your validation schema here
    })
  }

  async authorize(): Promise<boolean> {
    return true
  }
}
```

### `make:provider`

Generates a service provider class.

```bash
pnpm artisan make:provider App
# → app/Providers/AppServiceProvider.ts
```

Generated file:

```ts
import { ServiceProvider } from '@forge/core'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // bind services here
  }

  async boot(): Promise<void> {
    // run setup that depends on other providers
  }
}
```

## Summary Table

| Command | Output | Description |
|---------|--------|-------------|
| `make:controller <Name>` | `app/Http/Controllers/<Name>Controller.ts` | Decorator-based controller |
| `make:model <Name>` | `app/Models/<Name>.ts` | ORM Model class |
| `make:job <Name>` | `app/Jobs/<Name>Job.ts` | Queue Job class |
| `make:middleware <Name>` | `app/Http/Middleware/<Name>Middleware.ts` | Middleware class |
| `make:request <Name>` | `app/Http/Requests/<Name>Request.ts` | FormRequest class |
| `make:provider <Name>` | `app/Providers/<Name>ServiceProvider.ts` | ServiceProvider class |

## Tips

- Name generators in PascalCase — the CLI handles the suffix automatically
- Use `--force` to regenerate a file and overwrite existing content
- Generated files are minimal stubs — fill in your logic after generation
- Controllers are not automatically registered — add `router.registerController(YourController)` to `routes/api.ts`

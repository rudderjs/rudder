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
pnpm artisan make:controller User
# → app/Http/Controllers/UserController.ts
```

The `Controller` suffix is appended automatically if not provided. The route prefix is derived from the class name in kebab-case + pluralised (`User` → `/users`, `BlogPost` → `/blog-posts`).

Generated file:

```ts
import { Controller, Get } from '@boostkit/router'
import type { Context } from '@boostkit/core'

@Controller('/users')
export class UserController {
  @Get('/')
  async index(_ctx: Context) {
    return []
  }
}
```

### `make:model`

Generates an ORM model class. The table name is derived automatically from the class name in snake_case + pluralised (`Post` → `posts`, `BlogPost` → `blog_posts`).

```bash
pnpm artisan make:model Post
# → app/Models/Post.ts
```

Generated file:

```ts
import { Model } from '@boostkit/orm'

export class Post extends Model {
  static table = 'posts'

  static fillable: string[] = []

  static hidden: string[] = []
}
```

### `make:job`

Generates a queue job class.

```bash
pnpm artisan make:job SendWelcomeEmail
# → app/Jobs/SendWelcomeEmail.ts
```

Generated file:

```ts
import { Job } from '@boostkit/queue'

export class SendWelcomeEmail extends Job {
  static queue   = 'default'
  static retries = 3

  constructor(/* inject payload here */) {
    super()
  }

  async handle(): Promise<void> {
    // TODO: implement job logic
  }
}
```

### `make:middleware`

Generates a middleware class. The `Middleware` suffix is appended automatically if not provided.

```bash
pnpm artisan make:middleware Auth
# → app/Http/Middleware/AuthMiddleware.ts
```

Generated file:

```ts
import { Middleware } from '@boostkit/middleware'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

export class AuthMiddleware extends Middleware {
  async handle(
    req: AppRequest,
    res: AppResponse,
    next: () => Promise<void>
  ): Promise<void> {
    // TODO: implement middleware logic
    await next()
  }
}
```

### `make:request`

Generates a FormRequest class for input validation. The `Request` suffix is appended automatically if not provided.

```bash
pnpm artisan make:request CreateUser
# → app/Http/Requests/CreateUserRequest.ts
```

Generated file:

```ts
import { FormRequest, z } from '@boostkit/core'

export class CreateUserRequest extends FormRequest {
  authorize(): boolean {
    return true
  }

  rules() {
    return z.object({
      // TODO: define validation rules
    })
  }
}
```

### `make:provider`

Generates a service provider class. The `ServiceProvider` suffix is appended automatically if not provided.

```bash
pnpm artisan make:provider App
# → app/Providers/AppServiceProvider.ts
```

Generated file:

```ts
import { ServiceProvider } from '@boostkit/core'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // TODO: bind services into the container
    // this.app.singleton(MyService, () => new MyService())
  }

  async boot(): Promise<void> {
    // TODO: run logic after all providers are registered
  }
}
```

### `make:command`

Generates a class-based Artisan command. The signature is auto-derived from the class name in kebab-case (`SendDigest` → `send-digest`).

```bash
pnpm artisan make:command SendDigest
# → app/Commands/SendDigest.ts
```

Generated file:

```ts
import { Command } from '@boostkit/artisan'

export class SendDigest extends Command {
  readonly signature   = 'send-digest {--force : Force the operation}'
  readonly description = 'Description of SendDigest'

  async handle(): Promise<void> {
    this.info('Running SendDigest...')

    const force = this.option('force')
    if (force) this.comment('  Force flag is set')

    // TODO: implement

    this.info('Done.')
  }
}
```

Register it in `routes/console.ts`:

```ts
import { artisan } from '@boostkit/artisan'
import { SendDigest } from '../app/Commands/SendDigest.js'

artisan.register(SendDigest)
```

### `make:event`

Generates an event class.

```bash
pnpm artisan make:event UserRegistered
# → app/Events/UserRegistered.ts
```

Generated file:

```ts
export class UserRegistered {
  constructor(
    // public readonly userId: string,
  ) {}
}
```

### `make:listener`

Generates an event listener class.

```bash
pnpm artisan make:listener SendWelcomeEmail
# → app/Listeners/SendWelcomeEmail.ts
```

Generated file:

```ts
import type { Listener } from '@boostkit/core'

export class SendWelcomeEmail implements Listener {
  async handle(event: unknown): Promise<void> {
    // TODO: implement listener logic
  }
}
```

### `make:mail`

Generates a Mailable class for sending email.

```bash
pnpm artisan make:mail WelcomeMail
# → app/Mail/WelcomeMail.ts
```

Generated file:

```ts
import { Mailable } from '@boostkit/mail'

export class WelcomeMail extends Mailable {
  constructor(/* inject data here */) {
    super()
  }

  build(): this {
    return this
      .subject('Your subject here')
      .html('<p>Your HTML content here</p>')
      .text('Your plain text content here')
  }
}
```

## Summary Table

| Command | Output | Description |
|---------|--------|-------------|
| `make:controller <Name>` | `app/Http/Controllers/<Name>Controller.ts` | Decorator-based controller |
| `make:model <Name>` | `app/Models/<Name>.ts` | ORM Model class |
| `make:job <Name>` | `app/Jobs/<Name>.ts` | Queue Job class |
| `make:middleware <Name>` | `app/Http/Middleware/<Name>Middleware.ts` | Middleware class |
| `make:request <Name>` | `app/Http/Requests/<Name>Request.ts` | FormRequest class |
| `make:provider <Name>` | `app/Providers/<Name>ServiceProvider.ts` | ServiceProvider class |
| `make:command <Name>` | `app/Commands/<Name>.ts` | Class-based Artisan command |
| `make:event <Name>` | `app/Events/<Name>.ts` | Event class |
| `make:listener <Name>` | `app/Listeners/<Name>.ts` | Event listener class |
| `make:mail <Name>` | `app/Mail/<Name>.ts` | Mailable email class |

## Tips

- Name generators in PascalCase — the CLI handles the suffix automatically
- Use `--force` to regenerate a file and overwrite existing content
- Generated files are minimal stubs — fill in your logic after generation
- Controllers are not automatically registered — add `router.registerController(YourController)` to `routes/api.ts`

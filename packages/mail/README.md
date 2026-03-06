# @boostkit/mail

Mail facade, mailable abstraction, and provider factory with log and SMTP driver support.

## Installation

```bash
pnpm add @boostkit/mail
```

## Usage

```ts
// bootstrap/providers.ts
import { mail } from '@boostkit/mail'
import configs from '../config/index.js'

export default [
  mail(configs.mail),
]

import { Mail, Mailable } from '@boostkit/mail'
class WelcomeMail extends Mailable {
  build() { return this.subject('Welcome').text('Hello') }
}
await Mail.to('user@example.com').send(new WelcomeMail())
```

## API Reference

- `MailMessage`
- `Mailable`
- `SendOptions`
- `MailAdapter`, `MailAdapterProvider`
- `MailRegistry`
- `MailPendingSend`
- `Mail`
- `MailConnectionConfig`, `MailConfig`
- `mail(config)`

## Configuration

- `MailConfig`
  - `default`
  - `from`
  - `mailers`
- `MailConnectionConfig`
  - `driver`
  - additional driver-specific keys

## Notes

- Built-in driver: `log`.
- Built-in drivers: `log` and `smtp`.
- `smtp` requires optional dependency `nodemailer` (`pnpm add nodemailer`).

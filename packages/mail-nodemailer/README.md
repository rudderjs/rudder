# @boostkit/mail-nodemailer

Nodemailer SMTP adapter provider for `@boostkit/mail`.

## Installation

```bash
pnpm add @boostkit/mail-nodemailer
```

## Usage

```ts
import { nodemailer } from '@boostkit/mail-nodemailer'

const provider = nodemailer(
  {
    driver: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    username: 'user',
    password: 'pass',
    encryption: 'tls',
  },
  { address: 'noreply@example.com', name: 'Forge' }
)
```

## API Reference

- `NodemailerConfig`
- `nodemailer(config, from)` → `MailAdapterProvider`

## Configuration

- `NodemailerConfig`
  - `driver`
  - `host`, `port`
  - `username?`, `password?`
  - `encryption?` (`'tls' | 'ssl' | 'none'`)

## Notes

- Uses `nodemailer`.
- The exported function name is `nodemailer` (used by `@boostkit/mail` dynamic loading).

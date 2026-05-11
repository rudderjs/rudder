# @rudderjs/terminal

## Overview

Ink-based terminal UI for `rudder` commands. Commands return `terminal('id', props)` and the matching React component in `app/Terminal/` renders interactively in the TTY. Mirrors `@rudderjs/view` ergonomics (dot-notation id → file path) but for the terminal. Pairs with React 19 + Ink 7.

## Key Patterns

### Define a terminal component

```tsx
// app/Terminal/Welcome.tsx
import { Text, Box, useApp } from 'ink'
import { useEffect } from 'react'

interface WelcomeProps { name: string }

export default function Welcome({ name }: WelcomeProps) {
  const { exit } = useApp()
  useEffect(() => { setTimeout(exit, 2000) }, [exit])

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Hello, {name}!</Text>
      <Text dimColor>Exiting in 2 seconds…</Text>
    </Box>
  )
}
```

### Return it from a command

```ts
// routes/console.ts or a Command class
import { rudder } from '@rudderjs/core'
import { terminal } from '@rudderjs/terminal'

rudder.command('hello', async ({ args }) => {
  return terminal('welcome', { name: args[0] ?? 'World' })
})
```

`pnpm rudder hello Alice` renders `app/Terminal/Welcome.tsx` with `{ name: 'Alice' }`.

### Id → file mapping

| `terminal(...)` call         | Resolves to                            |
|------------------------------|-----------------------------------------|
| `terminal('welcome')`        | `app/Terminal/Welcome.tsx`              |
| `terminal('admin.users')`    | `app/Terminal/Admin/Users.tsx`          |
| `terminal('reports.daily')`  | `app/Terminal/Reports/Daily.tsx`        |

Dot-notation maps to nested folders. File names are PascalCase.

### Scaffold one quickly

```bash
pnpm rudder make:terminal Welcome
# → app/Terminal/Welcome.tsx with a stub component
```

### Long-running interactive UIs

Omit `useApp().exit()` and the command stays open until the user hits `Ctrl+C`. Useful for dashboards, monitors, REPL-style commands.

```tsx
import { useInput } from 'ink'

export default function Dashboard() {
  useInput((input, key) => {
    if (input === 'q' || key.escape) process.exit(0)
  })
  return /* … */
}
```

## Common Pitfalls

- **No TTY**: `terminal('...')` throws `terminal() requires an interactive terminal (TTY)` when stdout is piped or running in CI. If a command must work both interactively and in CI, gate the call: `if (process.stdout.isTTY) { return terminal(...) } else { console.log(...) }`.
- **Command hangs**: forgot to call `useApp().exit()` inside a `useEffect`. The Ink reconciler doesn't auto-exit; without an explicit signal the command waits indefinitely.
- **Component must have a default export**: `terminal('welcome')` does `import('./Welcome.tsx').then(m => m.default)`. Named exports won't resolve.
- **`ink@5.x` crashes against React 19**: error `Cannot read properties of undefined (reading 'ReactCurrentOwner')`. The package pins `ink@^7.0.0` which requires `react>=19.2.0` — don't downgrade.
- **`make:terminal` doesn't auto-create nested dirs**: `pnpm rudder make:terminal Admin.Users` creates `app/Terminal/Admin/Users.tsx` ✓; using slashes (`Admin/Users`) does not.

## Key Imports

```ts
import { terminal } from '@rudderjs/terminal'

import type {
  TerminalProps,           // type helper for props passed to a component
  TerminalResponse,        // return type of terminal() — what commands return
} from '@rudderjs/terminal'

// Ink helpers — these come from `ink`, not this package
import { Text, Box, Newline, useApp, useInput, useStdout } from 'ink'
```

## Required peers

`react@^19.2.0` and `ink@^7.0.0`. Install:

```bash
pnpm add @rudderjs/terminal react ink
```

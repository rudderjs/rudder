# @rudderjs/terminal

Laravel-style `terminal('id', props)` for the terminal — the same ergonomics as `view()`, but renders React/Ink components in the CLI instead of Vike pages in the browser.

## Installation

```bash
pnpm add @rudderjs/terminal react
```

## Usage

### 1. Create a terminal component

Generate with the scaffolder:

```bash
pnpm rudder make:terminal Dashboard
```

Or create manually in `app/Terminal/Dashboard.tsx`:

```tsx
import React from 'react'
import { Box, Text, useApp } from 'ink'

interface DashboardProps {
  appName: string
}

export default function Dashboard({ appName }: DashboardProps) {
  const { exit } = useApp()

  React.useEffect(() => {
    const t = setTimeout(() => exit(), 100)
    return () => clearTimeout(t)
  }, [exit])

  return (
    <Box padding={1}>
      <Text bold>{appName}</Text>
    </Box>
  )
}
```

### 2. Register a rudder command

```ts
// routes/console.ts
import { Rudder } from '@rudderjs/console'
import { terminal } from '@rudderjs/terminal'

Rudder.command('dashboard', async () => {
  return terminal('dashboard', { appName: 'MyApp' })
}).description('Show the dashboard')
```

### 3. Run it

```bash
pnpm rudder dashboard
```

## Component discovery

| `terminal(...)` call         | File resolved                         |
|------------------------------|---------------------------------------|
| `terminal('dashboard')`      | `app/Terminal/Dashboard.tsx`          |
| `terminal('admin.users')`    | `app/Terminal/Admin/Users.tsx`        |
| `terminal('auth.login')`     | `app/Terminal/Auth/Login.tsx`         |

## Notes

- Requires an interactive TTY — throws a clear error in CI or piped output
- Components must have a default export
- Use `useApp().exit()` from Ink to signal completion; omit it for long-running interactive UIs that exit on `Ctrl+C`
- `react` is a peer dependency — already present in `vike-react` apps

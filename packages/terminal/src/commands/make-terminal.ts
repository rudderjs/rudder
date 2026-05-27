import type { MakeSpec } from '@rudderjs/console'

export const makeTerminalSpec: MakeSpec = {
  command:     'make:terminal',
  description: 'Create a new terminal component',
  label:       'Terminal created',
  // No suffix: the stub is JSX (Ink), so it needs a `.tsx` extension, and the
  // `terminal('id')` resolver maps `'dashboard'` → `app/Terminal/Dashboard.tsx`
  // (no suffix). A `Terminal` suffix would emit `DashboardTerminal.tsx`, which
  // the resolver could never find. See packages/terminal/src/resolve.ts.
  extension:   'tsx',
  directory:   'app/Terminal',
  stub: (className: string) => `import React from 'react'
import { Box, Text } from 'ink'

interface ${className}Props {
  // add your props here
}

export default function ${className}({}: ${className}Props) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>${className}</Text>
    </Box>
  )
}
`,
}

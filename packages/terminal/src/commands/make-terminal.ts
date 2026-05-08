import type { MakeSpec } from '@rudderjs/console'

export const makeTerminalSpec: MakeSpec = {
  command:     'make:terminal',
  description: 'Create a new terminal component',
  label:       'Terminal created',
  suffix:      'Terminal',
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

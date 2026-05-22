export function terminalDashboardView(): string {
  return `import React, { useEffect } from 'react'
import { Box, Text, useApp } from 'ink'

export default function Dashboard() {
  const { exit } = useApp()

  useEffect(() => {
    exit()
  }, [])

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">Dashboard</Text>
      <Text>Hello from your terminal view!</Text>
      <Text dimColor>Edit app/Terminal/Dashboard.tsx to customize.</Text>
    </Box>
  )
}
`
}

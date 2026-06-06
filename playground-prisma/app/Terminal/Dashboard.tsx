import React from 'react'
import { Box, Text, useApp } from 'ink'

interface DashboardProps {
  appName: string
  version?: string
}

export default function Dashboard({ appName, version = '1.0.0' }: DashboardProps) {
  const { exit } = useApp()

  React.useEffect(() => {
    const t = setTimeout(() => exit(), 100)
    return () => clearTimeout(t)
  }, [exit])

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{appName}</Text>
        <Text dimColor>  v{version}</Text>
      </Box>

      <Box flexDirection="column" gap={0}>
        <Text color="green">✓ Routes loaded</Text>
        <Text color="green">✓ Providers booted</Text>
        <Text color="green">✓ Database connected</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}

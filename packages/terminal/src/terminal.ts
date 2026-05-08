import React from 'react'
import { render } from 'ink'
import { resolveComponent } from './resolve.js'

export type TerminalProps = Record<string, unknown>

/** @internal — exported for unit tests */
export function guardTTY(isTTY: boolean | undefined): void {
  if (!isTTY) {
    throw new Error(
      'terminal() requires an interactive terminal (TTY). ' +
      'Not supported in non-interactive environments (CI, piped output).',
    )
  }
}

/**
 * Render a terminal view from `app/Terminal/` with controller-supplied props.
 *
 * @param id    Dot-notation component id (e.g. 'dashboard' → app/Terminal/Dashboard.tsx)
 * @param props Plain object passed to the Ink component as props
 */
export async function terminal(id: string, props: TerminalProps = {}): Promise<void> {
  guardTTY(process.stdout.isTTY)
  const Component = await resolveComponent(id)
  const { waitUntilExit } = render(React.createElement(Component, props))
  await waitUntilExit()
}

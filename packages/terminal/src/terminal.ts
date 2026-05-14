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
 * **Lifecycle.** Resolves when the Ink component calls `useApp().exit()` or
 * the process receives SIGINT. Without an explicit `exit()` the command
 * hangs until Ctrl+C — components are expected to wire `useApp().exit()`
 * into their normal "done" path (form submitted, list selected, etc.).
 *
 * **Throws** in three cases:
 * - non-TTY environment (CI, piped stdout) — re-thrown from `guardTTY()`
 * - target file not found at any candidate extension — from `resolveComponent()`
 * - target file exists but has no default export — from `resolveComponent()`
 *
 * Callers from `routes/console.ts` typically don't try/catch — the rudder
 * CLI's top-level handler renders the error. Wrap manually when invoking
 * from a parent flow that needs to recover.
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

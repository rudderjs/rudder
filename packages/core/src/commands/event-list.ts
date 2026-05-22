import { dispatcher } from '../events.js'

// ─── Formatting ───────────────────────────────────────────

function printEvents(entries: { event: string; listeners: string[] }[]): void {
  if (entries.length === 0) {
    console.log('No events registered.')
    return
  }

  const eventWidth = Math.min(
    Math.max(...entries.map(e => e.event.length), 5),
    40,
  )

  console.log()
  console.log(`  \x1b[1m${'EVENT'.padEnd(eventWidth)}  LISTENERS\x1b[0m`)
  console.log(`  ${'─'.repeat(eventWidth)}  ${'─'.repeat(25)}`)

  for (const { event, listeners } of entries) {
    const label = event === '*' ? '\x1b[2m*\x1b[0m (wildcard)' : event
    const padding = ' '.repeat(Math.max(0, eventWidth - (event === '*' ? 1 : event.length)))
    const listenerLabel = listeners.length > 0 ? listeners.join(', ') : '\x1b[2m—\x1b[0m'
    console.log(`  ${label}${padding}  ${listenerLabel}`)
  }

  const total = entries.reduce((sum, e) => sum + e.listeners.length, 0)
  console.log()
  console.log(`  \x1b[2m${entries.length} event${entries.length === 1 ? '' : 's'}, ${total} listener${total === 1 ? '' : 's'}.\x1b[0m`)
  console.log()
}

// ─── Command Registration ─────────────────────────────────

/**
 * Register the `event:list` command with the rudder CLI.
 *
 * Walks the global EventDispatcher singleton (populated by providers' boot
 * lifecycle) and prints registered events alongside each listener's class
 * name. Supports `--filter <substring>` for narrowing and `--json` for
 * machine-readable output.
 */
export function registerEventListCommand(
  rudder: { command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown } },
): void {
  rudder.command('event:list', (args: string[]) => {
    const jsonFlag = args.includes('--json')
    const filterIdx = args.indexOf('--filter')
    const filterRaw = filterIdx >= 0 ? args[filterIdx + 1] : undefined
    const filterValue = filterRaw ? filterRaw.toLowerCase() : null

    let entries = dispatcher.inspect()
    if (filterValue !== null) {
      entries = entries.filter(e => e.event.toLowerCase().includes(filterValue))
    }

    if (jsonFlag) {
      console.log(JSON.stringify(entries, null, 2))
      return
    }

    printEvents(entries)
  }).description('List registered events and their listeners')
}

// ANSI Shadow "RUDDER" wordmark for the install banner.
//
// Printed once at the top of the interactive flow as a brand moment. Skipped
// in non-TTY environments (CI, agent JSON mode) and when `NO_COLOR` is set
// — the JSON branch in index.ts already returns before this is reached, but
// the TTY guard belt-and-suspenders the case where someone pipes the output.

// 6 rows × 51 columns. Each row is colored with a stop from the gradient
// below (top → bottom: light amber → brand orange → deep amber).
const LINES = [
  '██████╗ ██╗   ██╗██████╗ ██████╗ ███████╗██████╗ ',
  '██╔══██╗██║   ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗',
  '██████╔╝██║   ██║██║  ██║██║  ██║█████╗  ██████╔╝',
  '██╔══██╗██║   ██║██║  ██║██║  ██║██╔══╝  ██╔══██╗',
  '██║  ██║╚██████╔╝██████╔╝██████╔╝███████╗██║  ██║',
  '╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝',
]

// Gradient stops, top → bottom. Brand orange (#f3b02f) sits at the middle
// (row 2) so the eye lands on the framework's primary color.
const STOPS: [number, number, number][] = [
  [251, 208, 113],  // #fbd071 — light amber
  [247, 193,  77],  // #f7c14d
  [243, 176,  47],  // #f3b02f — brand orange
  [224, 155,  29],  // #e09b1d
  [198, 130,  20],  // #c68214
  [162, 106,  12],  // #a26a0c — deep amber
]

function colorize(line: string, [r, g, b]: [number, number, number]): string {
  return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`
}

/**
 * Print the colored RUDDER wordmark to stdout. No-op when stdout is not a
 * TTY (CI, pipes) or when NO_COLOR is set in the environment.
 */
export function printLogo(): void {
  if (!process.stdout.isTTY) return
  if (process.env['NO_COLOR']) {
    // Honor the NO_COLOR convention but still print the wordmark in plain
    // text so the brand presence isn't completely lost.
    for (const line of LINES) process.stdout.write(line + '\n')
    return
  }
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i]
    const stop = STOPS[i]
    if (line === undefined || stop === undefined) continue
    process.stdout.write(colorize(line, stop) + '\n')
  }
}

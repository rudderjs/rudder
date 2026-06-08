import type { Command } from 'commander'
import chalk from 'chalk'
import { down, up, type MaintenanceData } from '@rudderjs/core'

/**
 * `rudder down` — put the app into maintenance mode. Writes the
 * `storage/framework/down` flag file; the kernel maintenance middleware then
 * 503s every request until `rudder up`. Laravel-parity options:
 *
 *   --secret=<token>     bypass token — visit any URL with `?secret=<token>`
 *                        once to set a bypass cookie and browse normally
 *   --retry=<seconds>    value for the `Retry-After` response header
 *   --message=<text>     message shown in the 503 body
 *   --allow=<paths>      comma-separated paths always let through (e.g. /health)
 *
 * Skip-boot: writing a file needs no app context (and the app may be down
 * precisely because it can't boot).
 */
export function downCommand(program: Command): void {
  program
    .command('down')
    .description('Put the application into maintenance mode')
    .option('--secret <token>', 'Bypass token — visit ?secret=<token> to set a bypass cookie')
    .option('--retry <seconds>', 'Seconds for the Retry-After header')
    .option('--message <text>', 'Message shown in the 503 response body')
    .option('--allow <paths>', 'Comma-separated paths to allow through (e.g. /health,/status)')
    .action((opts: { secret?: string; retry?: string; message?: string; allow?: string }) => {
      const data: MaintenanceData = { time: Date.now() }
      if (opts.secret)  data.secret  = opts.secret
      if (opts.message) data.message = opts.message
      if (opts.retry) {
        const retry = Number(opts.retry)
        if (Number.isFinite(retry) && retry > 0) data.retry = retry
      }
      if (opts.allow) {
        const allow = opts.allow.split(',').map(p => p.trim()).filter(Boolean)
        if (allow.length) data.allow = allow
      }

      down(data, process.cwd())

      console.log(chalk.yellow('  ⏸  Application is now in maintenance mode.'))
      if (data.secret) console.log(chalk.dim(`     Bypass: visit any URL with ?secret=${data.secret}`))
      if (data.allow)  console.log(chalk.dim(`     Allowed: ${data.allow.join(', ')}`))
      console.log(chalk.dim('     Bring it back up with `rudder up`.'))
    })
}

/**
 * `rudder up` — bring the app out of maintenance mode (removes the flag file).
 * Skip-boot, same reasoning as `down`.
 */
export function upCommand(program: Command): void {
  program
    .command('up')
    .description('Bring the application out of maintenance mode')
    .action(() => {
      if (up(process.cwd())) {
        console.log(chalk.green('  ▶  Application is now live.'))
      } else {
        console.log(chalk.dim('  - Application was not in maintenance mode.'))
      }
    })
}

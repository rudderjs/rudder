import { pruneModels } from '../prune.js'

type Rudder = {
  command(
    name: string,
    handler: (args: string[]) => void | Promise<void>,
  ): { description(text: string): unknown }
}

/**
 * Register `pnpm rudder model:prune`.
 *
 * Walks the {@link import('../index.js').ModelRegistry} and prunes every
 * registered model that defines `static prunable()`. Filter with
 * `--model=A,B`, exclude with `--except=A`, change batch size with
 * `--chunk=N`, dry-run with `--pretend`.
 */
export function registerPruneCommand(rudder: Rudder): void {
  rudder.command('model:prune', async (args: string[]) => {
    const opts: import('../prune.js').PruneOptions = { pretend: args.includes('--pretend') }
    const models = arg(args, '--model')?.split(',').map(s => s.trim()).filter(Boolean)
    const except = arg(args, '--except')?.split(',').map(s => s.trim()).filter(Boolean)
    const chunk  = arg(args, '--chunk')
    if (models?.length) opts.models = models
    if (except?.length) opts.except = except
    if (chunk !== undefined) opts.chunk = Number(chunk)

    const reports = await pruneModels(opts)

    if (reports.length === 0) {
      console.log('  No prunable models registered.')
      return
    }

    const verb = opts.pretend ? 'Would prune' : 'Pruned'
    for (const r of reports) {
      console.log(`  ${verb} ${r.count.toLocaleString()} ${r.model} (${r.mode})`)
    }
    const total = reports.reduce((n, r) => n + r.count, 0)
    console.log(`  ${verb.toLowerCase()} ${total.toLocaleString()} record(s) across ${reports.length} model(s).`)
  }).description('Prune records from models implementing Prunable / MassPrunable — pnpm rudder model:prune [--model=A,B] [--except=X] [--chunk=N] [--pretend]')
}

/** Tiny `--name=value` / `--name value` parser, mirrors migrate.ts style. */
export function arg(args: string[], name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : undefined
}

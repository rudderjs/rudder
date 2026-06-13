import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Command } from 'commander'
import { CliError } from '../errors.js'

// Shell tab-completion for the `rudder` CLI. `rudder completion <shell>` prints a
// self-contained completion script to stdout; `rudder completion install` writes
// it to a stable location and wires it into the user's shell; `uninstall` undoes
// that cleanly.
//
// Command-name completion is STATIC: the script embeds the known framework
// command names below, so completing a command is instant (no CLI boot per
// <TAB>) and works even outside a project directory.
//
// Argument completion is DYNAMIC where it pays off: for the model-oriented make
// commands, the script calls back into `rudder completion args <command>`, which
// lists the project's models from app/Models (filesystem only, no app boot). The
// resolver is centralized in TS (testable) and structured so more arg sources can
// be added later. Route/package-command completion has no arg-taking command to
// complete against yet, so models are the whole dynamic surface today.
//
// No third-party dependency: hand-rolled scripts for bash / zsh / fish. tabtab
// was considered but its model is dynamic (a CLI round-trip per keystroke), which
// is the opposite of what static completion wants.

const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
}

export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish'] as const
export type Shell = (typeof SUPPORTED_SHELLS)[number]

/**
 * The static set of command names completed in v1. Built-in CLI commands plus
 * the commands every framework package contributes. Keep roughly in sync with
 * the ownership table in packages/cli/CLAUDE.md; drift here only costs a missing
 * suggestion, never a broken command. Every name has at most one ':' — the bash
 * script's colon handling relies on that.
 */
export const COMMAND_NAMES: readonly string[] = [
  // CLI built-ins
  'about', 'add', 'completion', 'doctor', 'down', 'fresh', 'optimize:clear',
  'remove', 'test', 'tinker', 'up', 'upgrade', 'key:generate',
  'command:list', 'module:make', 'module:publish', 'vendor:publish',
  'providers:discover',
  // make:* generators (CLI + packages)
  'make:agent', 'make:cast', 'make:command', 'make:controller', 'make:event',
  'make:exception', 'make:factory', 'make:job', 'make:listener', 'make:mail',
  'make:mcp-prompt', 'make:mcp-resource', 'make:mcp-server', 'make:mcp-tool',
  'make:middleware', 'make:migration', 'make:model', 'make:notification',
  'make:observer', 'make:passport-client', 'make:policy', 'make:provider',
  'make:request', 'make:resource', 'make:seeder', 'make:terminal', 'make:test',
  // @rudderjs/orm
  'migrate', 'migrate:fresh', 'migrate:refresh', 'migrate:rollback',
  'migrate:status', 'schema:types', 'db:generate', 'db:push', 'db:seed',
  'db:show', 'db:table', 'db:query', 'model:prune',
  // @rudderjs/router + openapi + core
  'route:list', 'openapi:generate', 'event:list', 'config:show',
  // @rudderjs/queue + cache + schedule
  'queue:work', 'queue:status', 'queue:clear', 'queue:failed', 'queue:retry',
  'cache:clear', 'schedule:run', 'schedule:work', 'schedule:list',
  // @rudderjs/storage + sync + broadcast + boost + passport + ai + mcp
  'storage:link', 'sync:docs', 'sync:clear', 'sync:inspect',
  'broadcast:connections', 'boost:install', 'boost:update', 'boost:mcp',
  'passport:keys', 'passport:client', 'ai:eval', 'mcp:start', 'mcp:list',
  // @rudderjs/vite sync commands
  'view:sync', 'routes:sync', 'env:sync', 'config:sync',
]

// ─── Dynamic argument resolution ─────────────────────────────

/**
 * Commands whose first argument is conventionally an existing model name. When
 * completing their argument, the shell calls back into `rudder completion args`
 * to list the project's models. Routes/migrations have no arg-taking command to
 * complete against yet, so models are the whole v1 surface.
 */
export const MODEL_ARG_COMMANDS: readonly string[] = [
  'make:factory', 'make:seeder', 'make:policy', 'make:observer',
]

/**
 * Resolve dynamic argument candidates for `command`, rooted at `cwd`. v1 returns
 * model names (the `app/Models` basenames) for the model-oriented make commands.
 * Filesystem-only, no app boot. Returns [] when there is nothing to suggest
 * (unknown command, not inside a project, empty dir).
 */
export function resolveArgCandidates(command: string, cwd: string = process.cwd()): string[] {
  if (MODEL_ARG_COMMANDS.includes(command)) return listModels(cwd)
  return []
}

/** List model names from `app/Models` by filename, mirroring tinker's discovery. */
function listModels(cwd: string): string[] {
  const dir = path.join(cwd, 'app', 'Models')
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return [] // not a rudder project, or no models yet
  }
  const exts = new Set(['.ts', '.js', '.mts', '.mjs'])
  const names = entries
    .filter(f => exts.has(path.extname(f)))
    .map(f => path.basename(f, path.extname(f)))
    .filter(n => n !== 'index')
  return [...new Set(names)].sort()
}

// ─── Script generation ───────────────────────────────────────

/** Emit a self-contained completion script for the given shell. */
export function completionScript(shell: Shell): string {
  const words   = [...COMMAND_NAMES].sort().join(' ')
  const argCmds = [...MODEL_ARG_COMMANDS].join(' ')
  switch (shell) {
    case 'bash': return bashScript(words, argCmds)
    case 'zsh':  return zshScript(words, argCmds)
    case 'fish': return fishScript(words, argCmds)
  }
}

function bashScript(words: string, argCmds: string): string {
  // Commands contain a ':' which is in bash's default COMP_WORDBREAKS, so the
  // word under the cursor is split. We reconstruct the colon-joined word and
  // strip the already-typed "ns:" prefix from each match so bash appends only
  // the suffix. Self-contained — no dependency on the bash-completion package.
  return `# rudder bash completion. Source this file or use \`rudder completion install\`.
_rudder_complete() {
  local cur cword cmd k
  cword="\${COMP_CWORD}"
  cur="\${COMP_WORDS[cword]}"

  # Reconstruct the command from the words between "rudder" and the current one.
  # Colon-split elements ("make" ":" "factory") concatenate back to "make:factory".
  # This equals a complete command name only once the command is fully typed and
  # the cursor sits on its argument (a partial like "make:" never matches).
  cmd=""
  for ((k=1; k<cword; k++)); do cmd="\${cmd}\${COMP_WORDS[k]}"; done
  if [[ " ${words} " == *" \${cmd} "* ]]; then
    # The cursor is on the command's argument, not the command itself. Only the
    # model-arg commands have dynamic candidates; others complete to nothing.
    local cand=""
    if [[ " ${argCmds} " == *" \${cmd} "* ]]; then
      cand=$(rudder completion args "\${cmd}" 2>/dev/null)
    fi
    COMPREPLY=( $(compgen -W "\${cand}" -- "\${cur}") )
    return 0
  fi

  # Glue a single-colon-split word back together under bash's default
  # COMP_WORDBREAKS (which contains ':'). Two shapes occur:
  #   "make" ":"        (cursor right after the colon)  -> cur = "make:"
  #   "make" ":" "mo"   (a suffix typed)                -> cur = "make:mo"
  if [ "\${cur}" = ":" ] && [ "\${cword}" -ge 1 ]; then
    cur="\${COMP_WORDS[cword-1]}:"
  elif [ "\${cword}" -ge 2 ] && [ "\${COMP_WORDS[cword-1]}" = ":" ]; then
    cur="\${COMP_WORDS[cword-2]}:\${cur}"
  fi
  local matches
  matches=$(compgen -W "${words}" -- "\${cur}")
  COMPREPLY=()
  if [[ "\${cur}" == *:* ]]; then
    local prefix="\${cur%:*}:" m
    for m in \${matches}; do COMPREPLY+=( "\${m#\${prefix}}" ); done
  else
    local m
    for m in \${matches}; do COMPREPLY+=( "\${m}" ); done
  fi
}
complete -F _rudder_complete rudder
`
}

function zshScript(words: string, argCmds: string): string {
  // zsh treats ':' as an ordinary word character, so no colon gymnastics needed.
  // Sourcing this file (rather than autoloading via fpath) means the #compdef tag
  // is inert, so we register explicitly via compdef once compinit has defined it.
  return `#compdef rudder
# rudder zsh completion. Source this file or use \`rudder completion install\`.
_rudder() {
  # Past the command word: complete its argument dynamically for the model-arg
  # commands ($words[2] is the command; zsh does not split on ':').
  if (( CURRENT >= 3 )); then
    local cmd="\${words[2]}"
    if [[ " ${argCmds} " == *" \${cmd} "* ]]; then
      local -a cand
      cand=(\${(f)"$(rudder completion args \${cmd} 2>/dev/null)"})
      compadd -a cand
    fi
    return
  fi
  local -a cmds
  cmds=(${words})
  compadd -a cmds
}
if (( $+functions[compdef] )); then
  compdef _rudder rudder
fi
`
}

function fishScript(words: string, argCmds: string): string {
  // fish autoloads files in its completions dir, so install drops this there and
  // no rc edit is needed. __fish_use_subcommand limits the command list to the
  // first position; the model-arg rule fires once such a subcommand is present.
  return `# rudder fish completion. Autoloaded from the fish completions dir, or use \`rudder completion install\`.
complete -c rudder -f -n '__fish_use_subcommand' -a '${words}'
complete -c rudder -f -n '__fish_seen_subcommand_from ${argCmds}' -a '(rudder completion args (commandline -opc)[2] 2>/dev/null)'
`
}

// ─── Install / uninstall plumbing ────────────────────────────

interface InstallPlan {
  /** Where the sourced completion script is written. */
  scriptPath: string
  /** The rc file to add a source line to, or null when the shell autoloads (fish). */
  rcFile:     string | null
  /** The exact line that sources the script (bash/zsh). */
  sourceLine: string
}

const BLOCK_START = '# >>> rudder completions >>>'
const BLOCK_END   = '# <<< rudder completions <<<'

/** Resolve the file locations for a shell, rooted at `home`. Pure — no I/O. */
export function installPlan(shell: Shell, home: string): InstallPlan {
  switch (shell) {
    case 'bash': {
      const scriptPath = path.join(home, '.rudder', 'completion.bash')
      return { scriptPath, rcFile: path.join(home, '.bashrc'), sourceLine: `[ -f "${scriptPath}" ] && source "${scriptPath}"` }
    }
    case 'zsh': {
      const scriptPath = path.join(home, '.rudder', 'completion.zsh')
      return { scriptPath, rcFile: path.join(home, '.zshrc'), sourceLine: `[ -f "${scriptPath}" ] && source "${scriptPath}"` }
    }
    case 'fish': {
      // fish autoloads any rudder.fish in its completions dir — no rc edit.
      const scriptPath = path.join(home, '.config', 'fish', 'completions', 'rudder.fish')
      return { scriptPath, rcFile: null, sourceLine: '' }
    }
  }
}

/** Detect the user's shell from $SHELL. Returns null if it isn't one we support. */
export function detectShell(env: NodeJS.ProcessEnv = process.env): Shell | null {
  const sh = path.basename(env['SHELL'] ?? '')
  return (SUPPORTED_SHELLS as readonly string[]).includes(sh) ? (sh as Shell) : null
}

function ensureDir(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
}

/** Read a file, treating a missing one as empty. Avoids a check-then-read race. */
function readOrEmpty(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

/** Remove a file if present, returning whether it existed. No check-then-use race. */
function rmIfExists(file: string): boolean {
  try {
    rmSync(file)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/** Idempotently add the source block to an rc file. Returns true if it changed. */
function addSourceBlock(rcFile: string, sourceLine: string): boolean {
  const existing = readOrEmpty(rcFile)
  if (existing.includes(BLOCK_START)) return false
  const block = `${BLOCK_START}\n${sourceLine}\n${BLOCK_END}\n`
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  writeFileSync(rcFile, existing + sep + block)
  return true
}

/** Remove the source block from an rc file. Returns true if it changed. */
function removeSourceBlock(rcFile: string): boolean {
  const existing = readOrEmpty(rcFile)
  if (!existing.includes(BLOCK_START)) return false
  // Strip the marked block (and a single trailing newline left behind).
  const pattern = new RegExp(`\\n?${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, 'g')
  writeFileSync(rcFile, existing.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n'))
  return true
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function runInstall(shell: Shell, home: string): void {
  const plan = installPlan(shell, home)
  ensureDir(plan.scriptPath)
  writeFileSync(plan.scriptPath, completionScript(shell))

  if (plan.rcFile) {
    const changed = addSourceBlock(plan.rcFile, plan.sourceLine)
    console.log(C.green('✓') + ` Installed ${shell} completions`)
    console.log(`  script: ${C.dim(plan.scriptPath)}`)
    console.log(changed
      ? `  added a source line to ${C.dim(plan.rcFile)}`
      : `  ${C.dim(plan.rcFile)} already sources it ${C.dim('(no change)')}`)
    console.log(`\nOpen a new shell or run ${C.bold(`source ${plan.rcFile}`)} to start completing.`)
  } else {
    // fish autoloads — nothing to source.
    console.log(C.green('✓') + ` Installed fish completions`)
    console.log(`  script: ${C.dim(plan.scriptPath)}`)
    console.log(`\nOpen a new shell to start completing.`)
  }
}

function runUninstall(shell: Shell, home: string): void {
  const plan = installPlan(shell, home)
  // rmIfExists attempts the remove and reports existence from the result, so
  // there is no check-then-remove race.
  let removed = rmIfExists(plan.scriptPath)
  if (plan.rcFile && removeSourceBlock(plan.rcFile)) removed = true
  console.log(removed
    ? C.green('✓') + ` Removed ${shell} completions`
    : C.yellow('•') + ` No ${shell} completions were installed`)
}

// ─── Command registration ────────────────────────────────────

/** Test surface — not part of the public API. */
export const _internal = { addSourceBlock, removeSourceBlock, runInstall, runUninstall, BLOCK_START, BLOCK_END }

export function completionCommand(program: Command): void {
  program
    .command('completion')
    .description('Shell tab-completion: print a script, or install/uninstall it')
    .argument('[action]', 'bash | zsh | fish | install | uninstall')
    .argument('[target]', 'internal: command name when action is "args"')
    .action((action: string | undefined, target: string | undefined) => {
      const home = os.homedir()

      // Internal: the installed scripts call `rudder completion args <command>`
      // to resolve dynamic argument candidates (e.g. model names). One per line.
      if (action === 'args') {
        if (target) process.stdout.write(resolveArgCandidates(target).join('\n') + '\n')
        return
      }

      // No arg, or an explicit shell name → print the script to stdout.
      if (action === undefined || (SUPPORTED_SHELLS as readonly string[]).includes(action)) {
        const shell = (action ?? detectShell()) as Shell | null
        if (!shell) {
          throw new CliError(
            'Could not detect your shell. Pass one explicitly:\n' +
            '  rudder completion bash | zsh | fish',
          )
        }
        process.stdout.write(completionScript(shell))
        return
      }

      if (action === 'install' || action === 'uninstall') {
        const shell = detectShell()
        if (!shell) {
          throw new CliError(
            `Could not detect a supported shell from $SHELL.\n` +
            `Generate the script manually instead, e.g.:\n` +
            `  rudder completion zsh > ~/.zsh/completions/_rudder`,
          )
        }
        if (action === 'install') runInstall(shell, home)
        else runUninstall(shell, home)
        return
      }

      throw new CliError(
        `Unknown completion action "${action}".\n` +
        `Usage: rudder completion [bash|zsh|fish|install|uninstall]`,
      )
    })
}

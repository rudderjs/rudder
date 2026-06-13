import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync } from 'node:fs'
import { Command } from 'commander'
import {
  completionScript, installPlan, detectShell, resolveArgCandidates, resolveFlagCandidates,
  COMMAND_NAMES, MODEL_ARG_COMMANDS, SUPPORTED_SHELLS, _internal,
} from './completion.js'

const { addSourceBlock, removeSourceBlock, runInstall, runUninstall, BLOCK_START } = _internal

// ── COMMAND_NAMES invariants ───────────────────────────────────

describe('completion — COMMAND_NAMES', () => {
  it('has no duplicates', () => {
    assert.equal(new Set(COMMAND_NAMES).size, COMMAND_NAMES.length)
  })

  it('every name has at most one colon (the bash colon-glue relies on it)', () => {
    for (const name of COMMAND_NAMES) {
      assert.ok((name.match(/:/g) ?? []).length <= 1, `"${name}" has more than one colon`)
    }
  })

  it('covers the headline commands', () => {
    for (const name of ['make:model', 'migrate', 'route:list', 'queue:work', 'completion']) {
      assert.ok(COMMAND_NAMES.includes(name), `missing ${name}`)
    }
  })
})

// ── completionScript ───────────────────────────────────────────

describe('completion — completionScript', () => {
  it('bash script registers a completion function and embeds commands', () => {
    const s = completionScript('bash')
    assert.match(s, /complete -F _rudder_complete rudder/)
    assert.ok(s.includes('make:model'))
    assert.ok(s.includes('migrate'))
    // Colon-glue logic is present so make:<TAB> works under default COMP_WORDBREAKS.
    assert.ok(s.includes('COMP_WORDS[cword-2]'))
  })

  it('zsh script defines _rudder and registers via compdef', () => {
    const s = completionScript('zsh')
    assert.match(s, /^#compdef rudder/)
    assert.ok(s.includes('compadd -a cmds'))
    assert.ok(s.includes('compdef _rudder rudder'))
    assert.ok(s.includes('make:model'))
  })

  it('fish script uses complete -c rudder limited to the subcommand position', () => {
    const s = completionScript('fish')
    assert.ok(s.includes('complete -c rudder'))
    assert.ok(s.includes('__fish_use_subcommand'))
    assert.ok(s.includes('make:model'))
  })

  it('emits commands in sorted order', () => {
    const s = completionScript('fish')
    const sorted = [...COMMAND_NAMES].sort().join(' ')
    assert.ok(s.includes(sorted))
  })

  it('each shell wires dynamic argument completion via `completion args`', () => {
    for (const shell of SUPPORTED_SHELLS) {
      const s = completionScript(shell)
      assert.ok(s.includes('completion args'), `${shell} script should call \`rudder completion args\``)
      assert.ok(s.includes('make:factory'), `${shell} script should embed the model-arg command list`)
    }
  })

  it('each shell wires flag completion via `completion flags`', () => {
    for (const shell of SUPPORTED_SHELLS) {
      assert.ok(completionScript(shell).includes('completion flags'), `${shell} script should call \`rudder completion flags\``)
    }
  })
})

// ── resolveFlagCandidates (live commander options) ─────────────

describe('completion — resolveFlagCandidates', () => {
  it('lists a command\'s long flags plus --help, sorted', () => {
    const cmd = new Command('make:model').option('-t, --with-test').option('--force').option('--migration')
    assert.deepEqual(resolveFlagCandidates(cmd), ['--force', '--help', '--migration', '--with-test'])
  })

  it('returns just --help for a command with no options', () => {
    assert.deepEqual(resolveFlagCandidates(new Command('tinker')), ['--help'])
  })

  it('returns the global flags when the command is unknown/top-level', () => {
    assert.deepEqual(resolveFlagCandidates(undefined), ['--help', '--version'])
  })
})

// ── resolveArgCandidates (dynamic model names) ─────────────────

describe('completion — resolveArgCandidates', () => {
  let proj: string

  beforeEach(async () => {
    proj = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-proj-'))
    const models = path.join(proj, 'app', 'Models')
    mkdirSync(models, { recursive: true })
    for (const f of ['Post.ts', 'User.ts', 'Comment.js', 'index.ts', 'notes.md']) {
      writeFileSync(path.join(models, f), '')
    }
  })
  afterEach(async () => { await fs.rm(proj, { recursive: true, force: true }) })

  it('lists model basenames (sorted) for a model-arg command, skipping index + non-source', () => {
    assert.deepEqual(resolveArgCandidates('make:factory', proj), ['Comment', 'Post', 'User'])
  })

  it('covers every model-arg command', () => {
    for (const cmd of MODEL_ARG_COMMANDS) {
      assert.deepEqual(resolveArgCandidates(cmd, proj), ['Comment', 'Post', 'User'], `${cmd} should resolve models`)
    }
  })

  it('returns [] for a command that takes no model argument', () => {
    assert.deepEqual(resolveArgCandidates('migrate', proj), [])
  })

  it('returns [] when app/Models is absent (not a project)', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'rudder-empty-'))
    try {
      assert.deepEqual(resolveArgCandidates('make:factory', empty), [])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

// ── installPlan / detectShell ──────────────────────────────────

describe('completion — installPlan', () => {
  // Build expectations with path.join so they match the platform separator
  // (installPlan uses path.join, so a hardcoded '/' literal fails on Windows).
  const home = path.join('/home', 'u')

  it('bash/zsh write under ~/.rudder and source from an rc file', () => {
    const bash = installPlan('bash', home)
    assert.equal(bash.scriptPath, path.join(home, '.rudder', 'completion.bash'))
    assert.equal(bash.rcFile, path.join(home, '.bashrc'))
    assert.ok(bash.sourceLine.includes(bash.scriptPath))

    const zsh = installPlan('zsh', home)
    assert.equal(zsh.scriptPath, path.join(home, '.rudder', 'completion.zsh'))
    assert.equal(zsh.rcFile, path.join(home, '.zshrc'))
  })

  it('fish autoloads from the completions dir with no rc file', () => {
    const fish = installPlan('fish', home)
    assert.equal(fish.scriptPath, path.join(home, '.config', 'fish', 'completions', 'rudder.fish'))
    assert.equal(fish.rcFile, null)
  })
})

describe('completion — detectShell', () => {
  it('recognizes supported shells from $SHELL', () => {
    assert.equal(detectShell({ SHELL: '/bin/zsh' } as NodeJS.ProcessEnv), 'zsh')
    assert.equal(detectShell({ SHELL: '/usr/local/bin/fish' } as NodeJS.ProcessEnv), 'fish')
  })

  it('returns null for an unknown or absent shell', () => {
    assert.equal(detectShell({ SHELL: '/bin/tcsh' } as NodeJS.ProcessEnv), null)
    assert.equal(detectShell({} as NodeJS.ProcessEnv), null)
  })
})

// ── addSourceBlock / removeSourceBlock idempotency ─────────────

describe('completion — rc block editing', () => {
  let dir: string
  let rc: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-completion-'))
    rc = path.join(dir, '.zshrc')
  })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('adds the block once and is idempotent', async () => {
    await fs.writeFile(rc, '# existing config\nexport FOO=1\n')
    assert.equal(addSourceBlock(rc, 'source /x'), true)
    assert.equal(addSourceBlock(rc, 'source /x'), false) // no second copy
    const content = readFileSync(rc, 'utf8')
    assert.equal(content.split(BLOCK_START).length - 1, 1)
    assert.ok(content.includes('# existing config')) // preserved
  })

  it('creates the rc file if missing', () => {
    assert.equal(existsSync(rc), false)
    assert.equal(addSourceBlock(rc, 'source /x'), true)
    assert.ok(readFileSync(rc, 'utf8').includes(BLOCK_START))
  })

  it('removeSourceBlock strips the block and preserves other lines', () => {
    addSourceBlock(rc, 'source /x')
    assert.equal(removeSourceBlock(rc), true)
    const content = readFileSync(rc, 'utf8')
    assert.ok(!content.includes(BLOCK_START))
    assert.equal(removeSourceBlock(rc), false) // already gone
  })
})

// ── bash functional completion (the colon handling is the fragile bit) ────────

describe('completion — bash script behaves under default COMP_WORDBREAKS', () => {
  // Source the emitted script in a real bash, drive _rudder_complete with the
  // word arrays bash produces (':' is a word-break char), and read COMPREPLY.
  // When `stubLines` is set, a fake `rudder` shell function emits those lines for
  // any `rudder completion args|flags ...` call — exercising the dynamic-arg and
  // flag branches without spawning node.
  function complete(words: string[], cword: number, stubLines?: string[]): string[] {
    // mkdtempSync gives a private 0700 dir with a random suffix, so the script
    // path is not predictable (no insecure-temp-file / symlink race).
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rudder-comp-'))
    try {
      const scriptPath = path.join(dir, 'completion.bash')
      writeFileSync(scriptPath, completionScript('bash'))
      // Stub `rudder` as a shell function (not a file): command-substitution
      // subshells inherit functions, so the script's `$(rudder completion ...)`
      // resolves to it. Avoids chmod/PATH, which keeps the test OS-portable.
      const stub = stubLines
        ? `rudder() { if [ "$1" = "completion" ]; then printf '%s\\n' ${stubLines.map(m => `'${m}'`).join(' ')}; fi; }\n`
        : ''
      const driver = `
        ${stub}source '${scriptPath}'
        COMP_WORDS=(${words.map(w => `'${w}'`).join(' ')}); COMP_CWORD=${cword}
        _rudder_complete
        printf '%s\\n' "\${COMPREPLY[@]}"
      `
      const out = execFileSync('bash', ['-c', driver], { encoding: 'utf8' })
      return out.split('\n').filter(Boolean)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  let bashAvailable = true
  try { execFileSync('bash', ['-c', 'true']) } catch { bashAvailable = false }

  it('plain prefix: rudder mig<TAB> includes migrate and its namespace', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'mig'], 1)
    assert.ok(r.includes('migrate'))
    assert.ok(r.includes('migrate:fresh'))
  })

  it('colon suffix: rudder make:mo<TAB> -> model (prefix stripped)', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':', 'mo'], 3)
    assert.deepEqual(r, ['model'])
  })

  it('bare namespace: rudder make:<TAB> lists the make subcommands, prefix-stripped', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':'], 2)
    assert.ok(r.includes('model'))
    assert.ok(r.includes('controller'))
    assert.ok(!r.some(x => x.includes(':')), 'suggestions should be the bare suffix, not full names')
  })

  it('model arg: rudder make:factory <TAB> -> model names from the resolver', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':', 'factory', ''], 4, ['Post', 'Comment', 'User'])
    assert.deepEqual(r.sort(), ['Comment', 'Post', 'User'])
  })

  it('model arg with prefix: rudder make:factory Po<TAB> -> Post', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':', 'factory', 'Po'], 4, ['Post', 'Comment', 'User'])
    assert.deepEqual(r, ['Post'])
  })

  it('non-model command argument suggests nothing (not the command list)', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'migrate', ''], 2, ['Post', 'User'])
    assert.deepEqual(r, [])
  })

  it('flag: rudder make:model --<TAB> -> the command flags from the resolver', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':', 'model', '--'], 4, ['--force', '--help', '--with-test'])
    assert.deepEqual(r.sort(), ['--force', '--help', '--with-test'])
  })

  it('flag with prefix: rudder make:model --wi<TAB> -> --with-test', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':', 'model', '--wi'], 4, ['--force', '--help', '--with-test'])
    assert.deepEqual(r, ['--with-test'])
  })

  it('flag after an argument: rudder make:model Foo --f<TAB> -> --force', { skip: !bashAvailable }, () => {
    const r = complete(['rudder', 'make', ':', 'model', 'Foo', '--f'], 5, ['--force', '--help', '--with-test'])
    assert.deepEqual(r, ['--force'])
  })

  it('top-level flags: rudder -<TAB> -> global flags', { skip: !bashAvailable }, () => {
    // No command yet, so the script offers the built-in global flags directly.
    const r = complete(['rudder', '-'], 1)
    assert.ok(r.includes('--help'))
    assert.ok(r.includes('--version'))
  })
})

// ── install / uninstall round-trip ─────────────────────────────

describe('completion — install/uninstall round-trip', () => {
  let home: string
  let log: typeof console.log

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-home-'))
    log = console.log
    console.log = () => {} // silence the user-facing output during tests
  })
  afterEach(async () => {
    console.log = log
    await fs.rm(home, { recursive: true, force: true })
  })

  for (const shell of SUPPORTED_SHELLS) {
    it(`${shell}: install writes the script, uninstall removes it`, () => {
      const plan = installPlan(shell, home)
      runInstall(shell, home)
      assert.ok(existsSync(plan.scriptPath), 'script written')
      if (plan.rcFile) assert.ok(readFileSync(plan.rcFile, 'utf8').includes(BLOCK_START), 'rc sources it')

      runInstall(shell, home) // idempotent
      if (plan.rcFile) {
        assert.equal(readFileSync(plan.rcFile, 'utf8').split(BLOCK_START).length - 1, 1)
      }

      runUninstall(shell, home)
      assert.ok(!existsSync(plan.scriptPath), 'script removed')
      if (plan.rcFile) assert.ok(!readFileSync(plan.rcFile, 'utf8').includes(BLOCK_START), 'rc cleaned')
    })
  }
})

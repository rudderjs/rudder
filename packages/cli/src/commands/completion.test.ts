import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {
  completionScript, installPlan, detectShell, COMMAND_NAMES, SUPPORTED_SHELLS, _internal,
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
})

// ── installPlan / detectShell ──────────────────────────────────

describe('completion — installPlan', () => {
  it('bash/zsh write under ~/.rudder and source from an rc file', () => {
    const bash = installPlan('bash', '/home/u')
    assert.equal(bash.scriptPath, '/home/u/.rudder/completion.bash')
    assert.equal(bash.rcFile, '/home/u/.bashrc')
    assert.ok(bash.sourceLine.includes(bash.scriptPath))

    const zsh = installPlan('zsh', '/home/u')
    assert.equal(zsh.scriptPath, '/home/u/.rudder/completion.zsh')
    assert.equal(zsh.rcFile, '/home/u/.zshrc')
  })

  it('fish autoloads from the completions dir with no rc file', () => {
    const fish = installPlan('fish', '/home/u')
    assert.equal(fish.scriptPath, '/home/u/.config/fish/completions/rudder.fish')
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
  function complete(words: string[], cword: number): string[] {
    // mkdtempSync gives a private 0700 dir with a random suffix, so the script
    // path is not predictable (no insecure-temp-file / symlink race).
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rudder-comp-'))
    try {
      const scriptPath = path.join(dir, 'completion.bash')
      writeFileSync(scriptPath, completionScript('bash'))
      const driver = `
        source '${scriptPath}'
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

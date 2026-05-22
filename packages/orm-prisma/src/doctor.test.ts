import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { findGeneratedClientDir } from './doctor.js'

let tmpDir: string

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orm-prisma-doctor-'))
})
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
})

function writeFile(rel: string, content: string): string {
  const abs = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf-8')
  return abs
}
function mkdir(rel: string): string {
  const abs = path.join(tmpDir, rel)
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

describe('findGeneratedClientDir', () => {
  it('returns null when nothing is generated', () => {
    writeFile('prisma/schema.prisma', 'generator client { provider = "prisma-client-js" }')
    assert.strictEqual(findGeneratedClientDir(['prisma/schema.prisma'], tmpDir), null)
  })

  it('detects schema-declared `output = "..."` resolved relative to the schema file', () => {
    // Prisma 7's `prisma-client` generator: output resolved relative to the
    // schema's directory. prisma/schema.prisma + output = "../generated/prisma"
    // → tmpDir/generated/prisma/.
    writeFile('prisma/schema.prisma', `generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}`)
    mkdir('generated/prisma')
    writeFile('generated/prisma/index.js', '// generated')

    const dir = findGeneratedClientDir(['prisma/schema.prisma'], tmpDir)
    assert.strictEqual(dir, path.join(tmpDir, 'generated/prisma'))
  })

  it('handles output on a nested schema dir (multi-file split)', () => {
    // create-rudder emits prisma/schema/<name>.prisma. The output path
    // resolves relative to that nested dir, so "../generated/prisma" lands
    // at tmpDir/prisma/generated/prisma.
    writeFile('prisma/schema/base.prisma', `generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}`)
    mkdir('prisma/generated/prisma')

    const dir = findGeneratedClientDir(['prisma/schema/base.prisma'], tmpDir)
    assert.strictEqual(dir, path.join(tmpDir, 'prisma/generated/prisma'))
  })

  it('falls back to the pnpm-shaped sibling of the resolved @prisma/client', () => {
    // Simulate pnpm layout: realpath of node_modules/@prisma/client lives
    // in a sibling .pnpm container; the generated .prisma/client/ sits at
    // <container>/node_modules/.prisma/client (i.e. ../../.prisma/client
    // from the resolved @prisma/client). The check uses realpathSync so a
    // symlink works correctly.
    // Resolve tmpDir's real path up front — macOS's /var symlink to
    // /private/var means realpathSync(tmpDir) != tmpDir and would otherwise
    // make this assertion brittle.
    const realTmp = fs.realpathSync(tmpDir)
    const pnpmContainer = path.join(realTmp, 'node_modules/.pnpm/@prisma+client@7.4.2/node_modules')
    mkdir('node_modules/.pnpm/@prisma+client@7.4.2/node_modules/@prisma/client')
    mkdir('node_modules/.pnpm/@prisma+client@7.4.2/node_modules/.prisma/client')
    writeFile('node_modules/.pnpm/@prisma+client@7.4.2/node_modules/.prisma/client/index.js', '// generated')
    mkdir('node_modules/@prisma')
    fs.symlinkSync(
      path.join(pnpmContainer, '@prisma/client'),
      path.join(tmpDir, 'node_modules/@prisma/client'),
    )

    const dir = findGeneratedClientDir([], tmpDir)
    assert.strictEqual(dir, path.join(pnpmContainer, '.prisma/client'))
  })

  it('falls back to the flat node_modules/.prisma/client layout', () => {
    // npm / yarn / legacy Prisma layout. No @prisma/client symlink needed.
    mkdir('node_modules/.prisma/client')
    writeFile('node_modules/.prisma/client/index.js', '// generated')

    const dir = findGeneratedClientDir([], tmpDir)
    assert.strictEqual(dir, path.join(tmpDir, 'node_modules/.prisma/client'))
  })

  it('prefers schema-declared output over either node_modules layout', () => {
    // Both candidates exist; the explicit `output =` should win because
    // the user actively configured it.
    writeFile('prisma/schema.prisma', `generator client {
  output = "../generated/prisma"
}`)
    mkdir('generated/prisma')
    mkdir('node_modules/.prisma/client')

    const dir = findGeneratedClientDir(['prisma/schema.prisma'], tmpDir)
    assert.strictEqual(dir, path.join(tmpDir, 'generated/prisma'))
  })

  it('ignores `output = "..."` when the declared path doesn\'t exist on disk', () => {
    // User configured an output that hasn't been generated yet. Resolver
    // skips it (returns null in this isolation) instead of pointing at a
    // non-existent dir.
    writeFile('prisma/schema.prisma', `generator client {
  output = "../never-existed/here"
}`)
    assert.strictEqual(findGeneratedClientDir(['prisma/schema.prisma'], tmpDir), null)
  })

  it('skips unreadable schemas gracefully', () => {
    // A schema path in the list that doesn\'t exist (e.g. stale entry, race
    // with a delete). Resolver should continue, not throw.
    mkdir('node_modules/.prisma/client')
    const dir = findGeneratedClientDir(['prisma/missing.prisma'], tmpDir)
    assert.strictEqual(dir, path.join(tmpDir, 'node_modules/.prisma/client'))
  })
})

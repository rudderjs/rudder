import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildTinkerContext, loadModels } from './tinker.js'

let tmpDir: string

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinker-test-'))
})
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
})

function writeModelFile(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  // Build under dist-test means we're running compiled .js; write .js so
  // the dynamic import works without a TS transformer in the loop.
  fs.writeFileSync(abs, content, 'utf-8')
}

describe('loadModels', () => {
  it('registers default exports under the filename stem', async () => {
    writeModelFile('User.js', 'class User {} export default User')
    const ctx: Record<string, unknown> = {}
    await loadModels(ctx, tmpDir)
    assert.equal(typeof ctx['User'], 'function')
  })

  it('registers named uppercase exports by name', async () => {
    writeModelFile('Auth.js', 'export class User {}\nexport class Post {}\n')
    const ctx: Record<string, unknown> = {}
    await loadModels(ctx, tmpDir)
    assert.equal(typeof ctx['User'], 'function')
    assert.equal(typeof ctx['Post'], 'function')
  })

  it('skips lowercase named exports (helpers, types) silently', async () => {
    writeModelFile('helpers.js', 'export const utility = () => 1\nexport class Model {}\n')
    const ctx: Record<string, unknown> = {}
    await loadModels(ctx, tmpDir)
    assert.strictEqual(ctx['utility'], undefined)
    assert.equal(typeof ctx['Model'], 'function')
  })

  it('returns silently when app/Models/ is missing', async () => {
    const ctx: Record<string, unknown> = {}
    await loadModels(ctx, path.join(tmpDir, 'does-not-exist'))
    assert.deepStrictEqual(ctx, {})
  })

  it('one broken model warns but does not block the others', async () => {
    writeModelFile('Good.js',   'export class Good {}\n')
    writeModelFile('Bad.js',    'this is not valid JS\n')
    writeModelFile('Other.js',  'export class Other {}\n')

    const ctx: Record<string, unknown> = {}
    // capture console.warn to prove the warning happened without blowing
    // up the suite output
    const originalWarn = console.warn
    const captured: string[] = []
    console.warn = (msg: string) => { captured.push(msg) }
    try {
      await loadModels(ctx, tmpDir)
    } finally {
      console.warn = originalWarn
    }

    assert.equal(typeof ctx['Good'],  'function', 'Good should load')
    assert.equal(typeof ctx['Other'], 'function', 'Other should load')
    assert.ok(captured.some(m => m.includes('Bad.js')), 'Bad.js failure should be warned')
  })

  it('ignores non-source files (no .ts/.js/.mts/.mjs)', async () => {
    writeModelFile('README.md', '# not a model')
    writeModelFile('schema.prisma', '// not a model')
    writeModelFile('Real.js', 'export class Real {}')

    const ctx: Record<string, unknown> = {}
    await loadModels(ctx, tmpDir)

    assert.equal(typeof ctx['Real'], 'function')
    assert.strictEqual(ctx['README'], undefined)
    assert.strictEqual(ctx['schema'], undefined)
  })
})

describe('buildTinkerContext', () => {
  it('includes app() and config from @rudderjs/core', async () => {
    // Empty models dir so we only assert on framework imports.
    const ctx = await buildTinkerContext(path.join(tmpDir, 'empty'))
    assert.equal(typeof ctx['app'],    'function', 'app() accessor should be in context')
    assert.equal(typeof ctx['config'], 'function', 'config() accessor should be in context')
    assert.ok(ctx['rudder'], 'rudder registry should be in context')
  })

  it('includes Route + route() + Url from @rudderjs/router when installed', async () => {
    const ctx = await buildTinkerContext(path.join(tmpDir, 'empty'))
    assert.ok(ctx['Route'], 'Route alias should be in context')
    assert.equal(typeof ctx['route'], 'function', 'route() URL helper should be in context')
    assert.ok(ctx['Url'], 'Url helper should be in context')
  })

  it('merges discovered models into the context', async () => {
    writeModelFile('Article.js', 'export class Article {}\n')
    writeModelFile('Tag.js',     'export default class Tag {}\n')

    const ctx = await buildTinkerContext(tmpDir)
    assert.equal(typeof ctx['Article'], 'function')
    assert.equal(typeof ctx['Tag'],     'function')
    // Framework entries should still be present alongside the models
    assert.equal(typeof ctx['app'], 'function')
  })
})

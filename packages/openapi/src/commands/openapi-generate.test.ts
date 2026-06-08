import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { Router } from '@rudderjs/router'
import { registerOpenApiGenerateCommand } from './openapi-generate.js'
import { toYaml } from '../yaml.js'

// The command resolves the GLOBAL `router` singleton from @rudderjs/router.
// Import it the same way and register routes so the command sees them.
const { router } = await import('@rudderjs/router') as { router: Router }

function captureCommand(): (args: string[]) => Promise<void> {
  let handler: ((args: string[]) => void | Promise<void>) | undefined
  const rudder = {
    command(_name: string, h: (args: string[]) => void | Promise<void>) {
      handler = h
      return { description: () => undefined }
    },
  }
  registerOpenApiGenerateCommand(rudder)
  return async (args) => { await handler!(args) }
}

test('openapi:generate writes a syntactically valid JSON spec', async () => {
  router.get('/items/:id', () => ({})).name('items.show').whereNumber('id')
    .responds(z.object({ id: z.number(), title: z.string() }))

  const out = path.join(tmpdir(), `rudder-openapi-${process.pid}.json`)
  const run = captureCommand()
  await run([`--out=${out}`])

  const raw = await readFile(out, 'utf8')
  const doc = JSON.parse(raw)
  assert.equal(doc.openapi, '3.1.0')
  assert.ok(doc.paths['/items/{id}']?.get, 'templated path present')
  assert.equal(doc.paths['/items/{id}'].get.parameters[0].schema.type, 'integer')

  await rm(out, { force: true })
})

test('openapi:generate --yaml writes parseable YAML-ish output', async () => {
  const out = path.join(tmpdir(), `rudder-openapi-${process.pid}.yaml`)
  const run = captureCommand()
  await run([`--out=${out}`, '--yaml'])

  const raw = await readFile(out, 'utf8')
  assert.match(raw, /openapi: "?3\.1\.0"?/)
  assert.match(raw, /paths:/)
  await rm(out, { force: true })
})

test('toYaml round-trips the basic document shape', () => {
  const yaml = toYaml({ openapi: '3.1.0', info: { title: 'X', version: '1.0.0' }, paths: {} })
  assert.match(yaml, /openapi: "3\.1\.0"|openapi: 3\.1\.0/)
  assert.match(yaml, /title: X/)
  assert.match(yaml, /paths: \{\}/)
})

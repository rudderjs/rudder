import { describe, it } from 'node:test'
import assert from 'node:assert'
import { makeResourceSpec } from './make-resource.js'

describe('make:resource spec', () => {
  it('has the expected spec fields', () => {
    assert.equal(makeResourceSpec.command, 'make:resource')
    assert.equal(makeResourceSpec.suffix, 'Resource')
    assert.equal(makeResourceSpec.directory, 'app/Resources')
    assert.equal(typeof makeResourceSpec.stub, 'function')
  })

  it('stub extends JsonResource and imports the inferred model', () => {
    const stub = makeResourceSpec.stub('UserResource')
    assert.ok(stub.includes('extends JsonResource'))
    assert.ok(stub.includes("import { JsonResource } from '@rudderjs/orm'"))
    assert.ok(stub.includes("import { User } from 'App/Models/User.js'"))
    assert.ok(stub.includes('toArray()'))
  })

  it('infers the model name by stripping the Resource suffix only', () => {
    // `PostResource` → model `Post`; a name with no embedded `Resource` stays intact.
    const stub = makeResourceSpec.stub('PostResource')
    assert.ok(stub.includes("import { Post } from 'App/Models/Post.js'"))
    assert.ok(stub.includes('class PostResource'))
  })
})

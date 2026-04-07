import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Resource }       from '../Resource.js'
import { Form }            from '../schema/Form.js'
import { Section }         from '../schema/Section.js'
import { Tabs }            from '../schema/Tabs.js'
import { Block }           from '../schema/Block.js'
import { TextField }       from '../schema/fields/TextField.js'
import { TextareaField }   from '../schema/fields/TextareaField.js'
import { BuilderField }    from '../schema/fields/BuilderField.js'
import type { Field }      from '../schema/Field.js'
import {
  extractBuilderCatalog,
  formatBuilderCatalog,
  buildBuilderCatalogPrompt,
  summarizeBuilderCatalog,
} from '../handlers/chat/blockCatalog.js'

function makeResource(fields: Field[]) {
  class R extends Resource {
    static label = 'Posts'
    form(form: Form) { return form.fields(fields) }
  }
  Object.defineProperty(R, 'name', { value: 'PostResource' })
  return new R()
}

describe('extractBuilderCatalog', () => {
  it('returns [] for a resource with no builder fields', () => {
    const resource = makeResource([
      TextField.make('title'),
      TextareaField.make('body'),
    ])
    assert.deepEqual(extractBuilderCatalog(resource), [])
  })

  it('returns [] for a builder field with no declared blocks', () => {
    const resource = makeResource([
      BuilderField.make('content'),
    ])
    assert.deepEqual(extractBuilderCatalog(resource), [])
  })

  it('extracts a single builder field with declared blocks', () => {
    const resource = makeResource([
      TextField.make('title'),
      BuilderField.make('content').blocks([
        Block.make('hero').label('Hero').schema([
          TextField.make('heading').required(),
          TextareaField.make('subheading'),
        ]),
        Block.make('callToAction').label('CTA').icon('🔗').schema([
          TextField.make('label'),
          TextField.make('url'),
        ]),
      ]),
    ])

    const catalog = extractBuilderCatalog(resource)
    assert.equal(catalog.length, 1)

    const builder = catalog[0]!
    assert.equal(builder.fieldName, 'content')
    assert.equal(builder.blocks.length, 2)

    const hero = builder.blocks[0]!
    assert.equal(hero.name, 'hero')
    assert.equal(hero.label, 'Hero')
    assert.equal(hero.schema.length, 2)
    assert.equal(hero.schema[0]?.name, 'heading')
    assert.equal(hero.schema[0]?.required, true)
    assert.equal(hero.schema[1]?.name, 'subheading')

    const cta = builder.blocks[1]!
    assert.equal(cta.name, 'callToAction')
    assert.equal(cta.icon, '🔗')
  })

  it('finds builder fields nested inside Sections', () => {
    const section = Section.make('Content').schema(
      BuilderField.make('content').blocks([
        Block.make('hero').schema([TextField.make('heading')]),
      ]),
    )
    const resource = makeResource([section as unknown as Field])

    const catalog = extractBuilderCatalog(resource)
    assert.equal(catalog.length, 1)
    assert.equal(catalog[0]?.fieldName, 'content')
    assert.equal(catalog[0]?.blocks[0]?.name, 'hero')
  })

  it('finds builder fields nested inside Tabs', () => {
    const tabs = Tabs.make().tab('Body',
      BuilderField.make('content').blocks([
        Block.make('text').schema([TextareaField.make('body')]),
      ]),
    )

    const resource = makeResource([tabs as unknown as Field])

    const catalog = extractBuilderCatalog(resource)
    assert.equal(catalog.length, 1)
    assert.equal(catalog[0]?.fieldName, 'content')
    assert.equal(catalog[0]?.blocks[0]?.name, 'text')
  })

  it('returns multiple builder fields when several exist', () => {
    const resource = makeResource([
      BuilderField.make('hero').blocks([Block.make('image').schema([])]),
      BuilderField.make('body').blocks([Block.make('paragraph').schema([])]),
    ])
    const catalog = extractBuilderCatalog(resource)
    assert.equal(catalog.length, 2)
    assert.equal(catalog[0]?.fieldName, 'hero')
    assert.equal(catalog[1]?.fieldName, 'body')
  })
})

describe('formatBuilderCatalog', () => {
  it('returns empty string for empty catalog', () => {
    assert.equal(formatBuilderCatalog([]), '')
  })

  it('renders block names, labels, and field schema', () => {
    const resource = makeResource([
      BuilderField.make('content').blocks([
        Block.make('hero').label('Hero').schema([
          TextField.make('heading').required(),
          TextareaField.make('subheading'),
        ]),
      ]),
    ])
    const out = formatBuilderCatalog(extractBuilderCatalog(resource))

    // Section header.
    assert.match(out, /## Available block types/)
    // Field group.
    assert.match(out, /`content`/)
    // Block name + label.
    assert.match(out, /`hero`.*Hero/)
    // Field schema lines with type + required flag.
    assert.match(out, /`heading` \(text\) — required/)
    assert.match(out, /`subheading` \(textarea\)/)
    // Tool usage hint.
    assert.match(out, /update_block/)
  })

  it('marks blocks with no fields as "_no fields_"', () => {
    const resource = makeResource([
      BuilderField.make('content').blocks([
        Block.make('divider').schema([]),
      ]),
    ])
    const out = formatBuilderCatalog(extractBuilderCatalog(resource))
    assert.match(out, /_no fields_/)
  })
})

describe('buildBuilderCatalogPrompt', () => {
  it('returns empty string when the resource has no builders', () => {
    const resource = makeResource([TextField.make('title')])
    assert.equal(buildBuilderCatalogPrompt(resource), '')
  })

  it('returns a non-empty section when builders exist', () => {
    const resource = makeResource([
      BuilderField.make('content').blocks([
        Block.make('hero').schema([TextField.make('heading')]),
      ]),
    ])
    const out = buildBuilderCatalogPrompt(resource)
    assert.notEqual(out, '')
    assert.match(out, /Available block types/)
  })
})

describe('summarizeBuilderCatalog', () => {
  it('returns empty string for empty catalog', () => {
    assert.equal(summarizeBuilderCatalog([]), '')
  })

  it('joins builder fields with their block counts', () => {
    const resource = makeResource([
      BuilderField.make('content').blocks([
        Block.make('a').schema([]),
        Block.make('b').schema([]),
      ]),
      BuilderField.make('hero').blocks([
        Block.make('image').schema([]),
      ]),
    ])
    const summary = summarizeBuilderCatalog(extractBuilderCatalog(resource))
    assert.equal(summary, 'content (2 block types), hero (1 block type)')
  })
})

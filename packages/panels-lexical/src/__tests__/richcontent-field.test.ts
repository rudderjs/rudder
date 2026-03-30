import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RichContentField } from '../RichContentField.js'

describe('RichContentField', () => {
  it('serializes type as richcontent', () => {
    const meta = RichContentField.make('content').toMeta()
    assert.equal(meta.type, 'richcontent')
    assert.equal(meta.name, 'content')
  })

  it('serializes placeholder in extra', () => {
    const meta = RichContentField.make('content')
      .placeholder('Start writing...')
      .toMeta()
    assert.equal(meta.extra?.placeholder, 'Start writing...')
  })

  it('serializes toolbar profile in extra', () => {
    const meta = RichContentField.make('content')
      .toolbar('document')
      .toMeta()
    assert.equal(meta.extra?.toolbar, 'document')
  })

  it('serializes toolbar tool array in extra', () => {
    const meta = RichContentField.make('content')
      .toolbar(['bold', 'italic', 'link'])
      .toMeta()
    assert.deepEqual(meta.extra?.toolbar, ['bold', 'italic', 'link'])
  })

  it('serializes slashCommand false in extra', () => {
    const meta = RichContentField.make('content')
      .slashCommand(false)
      .toMeta()
    assert.equal(meta.extra?.slashCommand, false)
  })

  it('serializes slashCommand tool array in extra', () => {
    const meta = RichContentField.make('content')
      .slashCommand(['heading', 'bulletList'])
      .toMeta()
    assert.deepEqual(meta.extra?.slashCommand, ['heading', 'bulletList'])
  })

  it('serializes blocks in extra', () => {
    const meta = RichContentField.make('content')
      .blocks([
        { toMeta: () => ({ name: 'callout', label: 'Callout', icon: '💡', schema: [] }) },
      ])
      .toMeta()
    assert.equal(Array.isArray(meta.extra?.blocks), true)
    assert.equal((meta.extra?.blocks as unknown[])?.[0]?.['name' as keyof object], 'callout')
  })

  it('chains all methods fluently', () => {
    const field = RichContentField.make('article')
      .label('Article Content')
      .placeholder('Write here...')
      .toolbar('document')
      .slashCommand(['heading', 'bulletList'])
      .blocks([])
      .required()

    const meta = field.toMeta()
    assert.equal(meta.name, 'article')
    assert.equal(meta.label, 'Article Content')
    assert.equal(meta.extra?.placeholder, 'Write here...')
    assert.equal(meta.extra?.toolbar, 'document')
    assert.equal(meta.required, true)
  })
})

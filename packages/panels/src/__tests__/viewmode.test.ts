
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ViewMode }  from '../schema/ViewMode.js'
import { Column }    from '../schema/Column.js'
import { DataField } from '../schema/DataField.js'

describe('ViewMode', () => {
  it('make() creates custom view', () => {
    const v = ViewMode.make('kanban')
    assert.equal(v.getType(), 'custom')
    assert.equal(v.getName(), 'kanban')
    assert.equal(v.getLabel(), 'Kanban')
  })

  it('list() creates list preset', () => {
    const v = ViewMode.list()
    assert.equal(v.getType(), 'list')
    assert.equal(v.getName(), 'list')
    assert.equal(v.getLabel(), 'List')
    assert.equal(v.getIcon(), 'list')
  })

  it('grid() creates grid preset', () => {
    const v = ViewMode.grid()
    assert.equal(v.getType(), 'grid')
    assert.equal(v.getName(), 'grid')
    assert.equal(v.getLabel(), 'Grid')
    assert.equal(v.getIcon(), 'layout-grid')
  })

  it('table() creates table preset with columns', () => {
    const cols = [Column.make('name'), Column.make('email')]
    const v = ViewMode.table(cols)
    assert.equal(v.getType(), 'table')
    assert.equal(v.getName(), 'table')
    assert.equal(v.getLabel(), 'Table')
    assert.equal(v.getIcon(), 'table')
    assert.deepEqual(v.getColumns(), cols)
  })

  it('label() overrides default label', () => {
    const v = ViewMode.make('cards').label('Card View')
    assert.equal(v.getLabel(), 'Card View')
  })

  it('label() auto-derives name for preset views', () => {
    const v = ViewMode.table([]).label('Compact')
    assert.equal(v.getName(), 'compact')
    assert.equal(v.getLabel(), 'Compact')
  })

  it('label() auto-derives unique names for duplicate types', () => {
    const v1 = ViewMode.table([]).label('Compact')
    const v2 = ViewMode.table([]).label('Detailed')
    assert.equal(v1.getName(), 'compact')
    assert.equal(v2.getName(), 'detailed')
    assert.notEqual(v1.getName(), v2.getName())
  })

  it('label() does not override name for custom views', () => {
    // ViewMode.make('kanban') sets name='kanban', type='custom'
    // name !== type, so label() should NOT override name
    const v = ViewMode.make('kanban').label('Board View')
    assert.equal(v.getName(), 'kanban')
    assert.equal(v.getLabel(), 'Board View')
  })

  it('name() explicitly overrides auto-derived name', () => {
    const v = ViewMode.table([]).label('Compact').name('tbl-compact')
    assert.equal(v.getName(), 'tbl-compact')
    assert.equal(v.getLabel(), 'Compact')
  })

  it('icon() sets icon', () => {
    const v = ViewMode.make('cards').icon('layout-grid')
    assert.equal(v.getIcon(), 'layout-grid')
  })

  it('render() stores render function', () => {
    const fn = (r: Record<string, unknown>) => []
    const v = ViewMode.make('cards').render(fn)
    assert.equal(v.getRenderFn(), fn)
  })

  it('getRenderFn() returns undefined when not set', () => {
    assert.equal(ViewMode.list().getRenderFn(), undefined)
  })

  it('getColumns() returns undefined for non-table views', () => {
    assert.equal(ViewMode.list().getColumns(), undefined)
    assert.equal(ViewMode.grid().getColumns(), undefined)
    assert.equal(ViewMode.make('custom').getColumns(), undefined)
  })
})

describe('ViewMode toMeta', () => {
  it('list preset meta', () => {
    const meta = ViewMode.list().toMeta()
    assert.equal(meta.type, 'list')
    assert.equal(meta.name, 'list')
    assert.equal(meta.label, 'List')
    assert.equal(meta.icon, 'list')
    assert.equal(meta.fields, undefined)
  })

  it('table preset meta includes fields', () => {
    const meta = ViewMode.table([Column.make('x')]).toMeta()
    assert.equal(meta.type, 'table')
    assert.equal(meta.fields?.length, 1)
    assert.equal(meta.fields?.[0]?.name, 'x')
  })

  it('list preset with fields includes them in meta', () => {
    const meta = ViewMode.list([DataField.make('name'), DataField.make('slug')]).toMeta()
    assert.equal(meta.fields?.length, 2)
    assert.equal(meta.fields?.[0]?.name, 'name')
    assert.equal(meta.fields?.[1]?.name, 'slug')
  })

  it('grid preset with editable field includes edit meta', () => {
    const meta = ViewMode.grid([DataField.make('name').editable()]).toMeta()
    assert.equal(meta.fields?.[0]?.editable, true)
    assert.equal(meta.fields?.[0]?.editMode, 'inline')
  })

  it('custom view meta omits icon when not set', () => {
    const meta = ViewMode.make('cards').toMeta()
    assert.equal(meta.type, 'custom')
    assert.equal(meta.icon, undefined)
  })

  it('custom view with icon includes it', () => {
    const meta = ViewMode.make('cards').icon('credit-card').toMeta()
    assert.equal(meta.icon, 'credit-card')
  })
})

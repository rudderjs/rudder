import type { Column, ColumnMeta } from './Column.js'

// ─── Table schema element ────────────────────────────────────
// Two modes:
//
//   Table.make('Recent Articles')       — resource-linked
//     .fromResource(ArticleResource)
//     .columns(['title', 'createdAt'])
//     .limit(5)
//
//   Table.make('All Users')             — model-backed
//     .fromModel(User)
//     .columns([Column.make('name').sortable().searchable()])
//     .limit(10)
//     .reorderable('position')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = { new(): any; query(): any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceClass = { new(): any; getSlug(): string; model?: ModelClass }

export interface PanelColumnMeta {
  name:        string
  label:       string
  sortable?:   boolean
  searchable?: boolean
  type?:       ColumnMeta['type']
  format?:     string
  href?:       string
}

export interface TableElementMeta {
  type:              'table'
  title:             string
  resource:          string
  columns:           PanelColumnMeta[]
  records:           unknown[]
  href:              string
  reorderable?:      boolean
  reorderEndpoint?:  string
}

export interface TableConfig {
  title:          string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceClass?: any              // fromResource() — Resource class
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?:         any              // fromModel() — direct model class
  columns:        string[] | Column[]
  limit:          number
  sortBy:         string | undefined
  sortDir:        'ASC' | 'DESC'
  reorderable:    boolean
  reorderField:   string
}

export class Table {
  private _title:          string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _resourceClass?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _model?:         any
  private _columns:        string[] | Column[] = []
  private _limit:          number              = 5
  private _sortBy?:        string
  private _sortDir:        'ASC' | 'DESC'      = 'DESC'
  private _reorderable:    boolean             = false
  private _reorderField:   string              = 'position'

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Table {
    return new Table(title)
  }

  /**
   * Use a Resource class as the data source.
   * Inherits the Resource's model, default sort, and field labels.
   *
   * @example
   * Table.make('Recent Articles')
   *   .fromResource(ArticleResource)
   *   .columns(['title', 'createdAt'])
   *   .limit(5)
   *
   * // With explicit Column definitions:
   * Table.make('Recent Articles')
   *   .fromResource(ArticleResource)
   *   .columns([Column.make('title').sortable(), Column.make('createdAt').date()])
   */
  fromResource(resourceClass: ResourceClass): this {
    this._resourceClass = resourceClass
    this._model         = resourceClass.model
    return this
  }

  /**
   * Use an ORM Model class directly as the data source (no Resource needed).
   * Define display columns with Column.make().
   *
   * @example
   * Table.make('All Users')
   *   .fromModel(User)
   *   .columns([Column.make('name').sortable().searchable(), Column.make('email')])
   *   .limit(10)
   */
  fromModel(model: ModelClass): this {
    this._model = model
    return this
  }

  /** Column names (resolved via Resource fields) or Column instances. */
  columns(cols: string[] | Column[]): this {
    this._columns = cols
    return this
  }

  limit(n: number): this {
    this._limit = n
    return this
  }

  sortBy(col: string, dir: 'ASC' | 'DESC' = 'DESC'): this {
    this._sortBy  = col
    this._sortDir = dir
    return this
  }

  /**
   * Enable drag-to-reorder rows.
   * Saves the new order to `positionField` (default: 'position') via the panel API.
   * Requires a numeric position column on the model's table.
   */
  reorderable(positionField = 'position'): this {
    this._reorderable  = true
    this._reorderField = positionField
    return this
  }

  getType(): 'table' { return 'table' }

  getConfig(): TableConfig {
    return {
      title:         this._title,
      resourceClass: this._resourceClass,
      model:         this._model,
      columns:       this._columns,
      limit:         this._limit,
      sortBy:        this._sortBy,
      sortDir:       this._sortDir,
      reorderable:   this._reorderable,
      reorderField:  this._reorderField,
    }
  }
}

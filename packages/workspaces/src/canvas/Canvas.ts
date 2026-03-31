// ─── Canvas Element Meta ─────────────────────────────────

export interface CanvasElementMeta {
  type: 'canvas'
  id: string
  editable: boolean
  collaborative: boolean
  persist: boolean
  scope?: boolean | undefined
}

// ─── Canvas Schema Element ───────────────────────────────

/**
 * Canvas — schema element for rendering a collaborative 3D workspace.
 *
 * Used in page schemas or resource detail views.
 * Queries workspace data via `.scope()`.
 *
 * @example
 * Canvas.make('workspace')
 *   .scope((q) => q.where('id', record.id))
 *   .editable()
 *   .collaborative()
 *   .persist()
 */
export class Canvas {
  private _id: string
  private _editable = false
  private _collaborative = false
  private _persist = false
  private _scopeFn?: ((q: any) => any) | undefined

  private constructor(id: string) {
    this._id = id
  }

  static make(id: string): Canvas {
    return new Canvas(id)
  }

  /** Apply a query scope to filter workspace data. */
  scope(fn: (q: any) => any): this {
    this._scopeFn = fn
    return this
  }

  /** Allow drag/drop, add/delete nodes, edit connections. */
  editable(): this {
    this._editable = true
    return this
  }

  /** Enable real-time collaborative editing via Yjs. */
  collaborative(): this {
    this._collaborative = true
    return this
  }

  /** Persist per-user viewport (zoom/pan) in localStorage. */
  persist(): this {
    this._persist = true
    return this
  }

  // ─── Internal ────────────────────────────────────────

  getId(): string { return this._id }
  isEditable(): boolean { return this._editable }
  isCollaborative(): boolean { return this._collaborative }
  isPersist(): boolean { return this._persist }
  getScope(): ((q: any) => any) | undefined { return this._scopeFn }

  getType(): 'canvas' { return 'canvas' }

  toMeta(): CanvasElementMeta {
    return {
      type: 'canvas',
      id: this._id,
      editable: this._editable,
      collaborative: this._collaborative,
      persist: this._persist,
      scope: this._scopeFn !== undefined ? true : undefined,
    }
  }
}

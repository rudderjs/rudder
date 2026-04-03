// ─── Layout ────────────────────────────────────────────────

export type PanelLayout = 'sidebar' | 'topbar'

// ─── Policy ────────────────────────────────────────────────

export type PolicyAction = 'viewAny' | 'view' | 'create' | 'update' | 'delete' | 'restore' | 'forceDelete'

// ─── Panel Context ─────────────────────────────────────────

export interface PanelUser {
  id:    string | number
  name?: string
  email?: string
  role?: string
  [key: string]: unknown
}

export interface PanelContext {
  user:    PanelUser | undefined
  headers: Record<string, string>
  path:    string
  /** Route params extracted from the page's slug pattern. Optional params that weren't matched are `undefined`. */
  params:  Record<string, string | undefined>
  /** URL search/query params (for persist='url' tabs). */
  urlSearch?: Record<string, string>
  /** Session getter (for persist='session' tabs). Provided by +data.ts during Vike SSR. */
  sessionGet?: (key: string) => unknown
}

// ─── Guard ─────────────────────────────────────────────────

export type PanelGuard = (ctx: PanelContext) => boolean | Promise<boolean>

// ─── Branding ──────────────────────────────────────────────

export interface BrandingOptions {
  title?:   string
  logo?:    string
  favicon?: string
  colors?: {
    primary?:    string
    background?: string
  }
}

// ─── Common data shapes ────────────────────────────────────────

/** A single database record row. Values are JSON-serialisable unknowns. */
export type RecordRow = Record<string, unknown>

/** Validated or raw form submission payload. */
export type FormValues = Record<string, unknown>

/** Raw HTTP request body before validation/coercion. */
export type RequestBody = Record<string, unknown>

// ─── Schema builder duck-type ──────────────────────────────────

/**
 * Minimal structural interface for all panels schema builder objects
 * (Table, Form, Dialog, Widget, Chart, List, Stats, etc.).
 * Builders expose `getType()` for dispatch and `toMeta()` for serialisation.
 */
export interface SchemaElementLike {
  getType(): string
  toMeta(): unknown
}

// ─── ORM Model interface (structural — no @rudderjs/orm dep) ──

export interface PaginatedResult<T = Record<string, unknown>> {
  data:        T[]
  total:       number
  currentPage: number
  perPage:     number
  lastPage:    number
  from:        number
  to:          number
}

export interface QueryBuilderLike<T = Record<string, unknown>> {
  where(col: string, value: unknown): QueryBuilderLike<T>
  where(col: string, op: string, value: unknown): QueryBuilderLike<T>
  orWhere(col: string, value: unknown): QueryBuilderLike<T>
  orWhere(col: string, op: string, value: unknown): QueryBuilderLike<T>
  orderBy(col: string, dir?: 'ASC' | 'DESC'): QueryBuilderLike<T>
  limit(n: number): QueryBuilderLike<T>
  offset(n: number): QueryBuilderLike<T>
  with(...relations: string[]): QueryBuilderLike<T>
  get(): Promise<T[]>
  all(): Promise<T[]>
  first(): Promise<T | null>
  find(id: string | number): Promise<T | null>
  count(): Promise<number>
  paginate(page: number, perPage?: number): Promise<PaginatedResult<T>>
  create(data: Partial<T>): Promise<T>
  update(id: string | number, data: Partial<T>): Promise<T>
  delete(id: string | number): Promise<void>
}

export interface ModelClass<T = Record<string, unknown>> {
  new (): T
  all(): Promise<T[]>
  find(id: string | number): Promise<T | null>
  create(data: Partial<T>): Promise<T>
  query(): QueryBuilderLike<T>
  where(col: string, value: unknown): QueryBuilderLike<T>
  with(...relations: string[]): QueryBuilderLike<T>
}

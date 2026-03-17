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

// ─── ORM Model interface (structural — no @boostkit/orm dep) ──

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

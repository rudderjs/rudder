// ─── Raw SQL expression wrapper ────────────────────────────
//
// `DB.raw(...)` / `raw(...)` wraps a literal SQL fragment so the query layer can
// tell it apart from a bound value and splice it verbatim instead of
// parameterizing it. Mirrors Laravel's `Illuminate\Database\Query\Expression`.
//
// Lives in `@rudderjs/contracts` (not `@rudderjs/database`) because the query
// builder's raw methods are reachable from the Model layer / client bundle, and
// `@rudderjs/database` is node-only. `@rudderjs/database` re-exports these so
// `DB.raw()` keeps its public import path.

/**
 * An opaque raw-SQL fragment. Construct via {@link raw}. Carries the literal
 * value and stringifies to it — the query layer reads `getValue()` to splice it
 * into compiled SQL without binding.
 */
export class Expression {
  constructor(private readonly value: string | number) {}

  /** The wrapped literal SQL fragment (or numeric literal). */
  getValue(): string | number {
    return this.value
  }

  toString(): string {
    return String(this.value)
  }
}

/**
 * Wrap a literal SQL fragment as an {@link Expression} so the query layer
 * splices it verbatim instead of binding it as a value.
 *
 * @example
 * raw('NOW()')
 * raw('count(*) as total')
 */
export function raw(value: string | number): Expression {
  return new Expression(value)
}

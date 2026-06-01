// ─── Raw SQL expression wrapper ────────────────────────────
//
// `DB.raw(...)` wraps a literal SQL fragment so the query layer can tell it
// apart from a bound value and splice it verbatim instead of parameterizing it.
// Mirrors Laravel's `Illuminate\Database\Query\Expression`.
//
// PR1 ships the wrapper itself; threading `Expression` through the query-builder
// compiler is a later PR. Today it's the type a raw fragment travels as.

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
 * DB.raw('NOW()')
 * DB.raw('count(*) as total')
 */
export function raw(value: string | number): Expression {
  return new Expression(value)
}

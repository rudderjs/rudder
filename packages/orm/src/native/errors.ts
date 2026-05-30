// Errors for the native ORM engine (`@rudderjs/orm/native`).
//
// Kept in their own module so both the pure compiler/query-builder and the
// node-only adapter/driver can throw them without pulling each other in.

/** Base class for every error raised by the native engine. Carries a stable
 *  `code` so apps can branch on `instanceof NativeOrmError` + `.code` instead
 *  of message matching. */
export class NativeOrmError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined)
    this.name = 'NativeOrmError'
    this.code = code
  }
}

/**
 * Thrown by `NativeQueryBuilder` terminals that aren't implemented yet in the
 * current phase. Phase 1 ships the **read** path only — every write, relation,
 * aggregate, and vector terminal throws this until its phase lands.
 *
 * The message names the missing terminal and the phase that delivers it so the
 * failure is self-explanatory rather than a generic "not a function".
 */
export class NativeNotImplementedError extends NativeOrmError {
  /** The QueryBuilder method that isn't available yet. */
  readonly method: string

  constructor(method: string, phase: string) {
    super(
      'NATIVE_NOT_IMPLEMENTED',
      `[RudderJS ORM native] "${method}" is not implemented yet — it lands in ${phase}. ` +
      `Phase 1 of the native engine ships the read path only ` +
      `(first/find/get/all/count/paginate). Use @rudderjs/orm-prisma or ` +
      `@rudderjs/orm-drizzle for the full surface until then.`,
    )
    this.name = 'NativeNotImplementedError'
    this.method = method
  }
}

/**
 * Thrown when an identifier (table or column name) supplied to the compiler
 * fails validation. Because identifiers can't be parameterized, the native
 * engine validates them against a strict allowlist before quoting — this is a
 * security gate (cross-phase rule 3), not a style check.
 */
export class NativeIdentifierError extends NativeOrmError {
  /** The rejected identifier. */
  readonly identifier: string

  constructor(identifier: string) {
    super(
      'NATIVE_INVALID_IDENTIFIER',
      `[RudderJS ORM native] Invalid SQL identifier ${JSON.stringify(identifier)}. ` +
      `Identifiers may contain only letters, digits, underscores, and dots, and ` +
      `must not start with a digit. Values are always bound as parameters; only ` +
      `column/table names flow through this check.`,
    )
    this.name = 'NativeIdentifierError'
    this.identifier = identifier
  }
}

/**
 * Thrown when a driver package (e.g. `better-sqlite3`) can't be resolved at
 * runtime. The drivers are optional peers — apps install only the one they use.
 */
export class NativeDriverError extends NativeOrmError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('NATIVE_DRIVER_ERROR', message, options)
    this.name = 'NativeDriverError'
  }
}
